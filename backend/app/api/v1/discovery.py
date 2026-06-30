"""Discovery engine API — top picks, news, stock history, status, manual scan."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.deps import CurrentUser, require_role
from app.core.scheduler import (
    is_scan_running,
    last_scan_info,
    run_full_scan,
    get_scheduler,
)
from app.domain.models.discovery import DiscoveryStatus, StockScore
from app.domain.models.user import UserRole
from app.infra.db.repositories.discovery_repo import DiscoveryRepository

router = APIRouter(prefix="/discovery", tags=["discovery"])

_VALID_SIGNALS = {"STRONG_BUY", "BUY", "WATCH", "NEUTRAL", "SELL", "STRONG_SELL"}


def _serialize_score(s: StockScore) -> dict:
    return {
        "id": str(s.id),
        "symbol": s.symbol,
        "name": s.name,
        "score": s.score,
        "signal": s.signal,
        "confidence": s.confidence,
        "entry_price": s.entry_price,
        "stop_loss": s.stop_loss,
        "targets": s.targets,
        "holding_period": s.holding_period,
        "risk_reward_ratio": s.risk_reward_ratio,
        "technical_score": s.technical_score,
        "news_score": s.news_score,
        "ml_score": s.ml_score,
        "social_score": s.social_score,
        "patterns": s.patterns,
        "explanation": s.explanation,
        "scanned_at": s.scanned_at.isoformat(),
    }


@router.get("/top-picks")
async def top_picks(
    current_user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=50),
    signal: str | None = Query(default=None),
    min_score: float = Query(default=0.0, ge=0, le=100),
) -> list[dict]:
    if signal and signal not in _VALID_SIGNALS and signal not in ("BUY", "SELL"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"signal must be one of {sorted(_VALID_SIGNALS)} or BUY/SELL",
        )
    repo = DiscoveryRepository()
    picks = await repo.get_top_picks(
        limit=limit,
        signal_filter=signal,
        min_score=min_score,
    )
    return [_serialize_score(s) for s in picks]


@router.get("/scores/{symbol}")
async def symbol_history(
    symbol: str,
    current_user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=50),
) -> list[dict]:
    sym = symbol.upper()
    if not sym.endswith((".NS", ".BO")):
        sym += ".NS"
    repo = DiscoveryRepository()
    scores = await repo.get_scores_for_symbol(sym, limit=limit)
    return [_serialize_score(s) for s in scores]


@router.get("/news")
async def discovery_news(
    current_user: CurrentUser,
    symbol: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    sym = None
    if symbol:
        sym = symbol.upper()
        if not sym.endswith((".NS", ".BO")):
            sym += ".NS"
    repo = DiscoveryRepository()
    items = await repo.get_news(symbol=sym, limit=limit)
    return [
        {
            "id": str(n.id),
            "title": n.title,
            "source": n.source,
            "url": n.url,
            "published_at": n.published_at.isoformat(),
            "sentiment_score": n.sentiment_score,
            "mentioned_symbols": n.mentioned_symbols,
            "summary": n.summary,
        }
        for n in items
    ]


@router.get("/status")
async def discovery_status(current_user: CurrentUser) -> dict:
    repo = DiscoveryRepository()
    last_scan_at, stocks_scanned = last_scan_info()

    # Fall back to DB if process restarted
    if last_scan_at is None:
        last_scan_at = await repo.get_latest_scan_time()
        if last_scan_at:
            stocks_scanned = await repo.count_latest_scan()

    scheduler = get_scheduler()
    next_scan_at: datetime | None = None
    if scheduler and scheduler.running:
        job = scheduler.get_job("full_scan")
        if job and job.next_run_time:
            next_scan_at = job.next_run_time.replace(tzinfo=None)

    return {
        "last_scan_at": last_scan_at.isoformat() if last_scan_at else None,
        "next_scan_at": next_scan_at.isoformat() if next_scan_at else None,
        "stocks_scanned": stocks_scanned,
        "is_running": is_scan_running(),
        "scheduler_active": bool(scheduler and scheduler.running),
        "universe_size": _universe_size(),
        "social_providers": {
            "twitter": False,
            "reddit": False,
            "youtube": False,
            "telegram": False,
            "google_trends": False,
        },
    }


@router.post("/scan", status_code=status.HTTP_202_ACCEPTED)
async def trigger_scan(
    request: Request,
    current_user: CurrentUser,
) -> dict:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin only",
        )
    if is_scan_running():
        return {"message": "Scan already in progress", "started": False}
    import asyncio
    asyncio.create_task(run_full_scan())
    return {"message": "Discovery scan started", "started": True}


@router.get("/reports")
async def list_reports(
    current_user: CurrentUser,
    limit: int = Query(default=50, le=200),
    skip: int = Query(default=0, ge=0),
) -> list[dict]:
    """Return report history summaries newest-first (picks list excluded)."""
    repo = DiscoveryRepository()
    return await repo.list_reports(limit=limit, skip=skip)


@router.get("/reports/{report_id}")
async def get_report(report_id: str, current_user: CurrentUser) -> dict:
    """Return a single report including the full picks list."""
    repo = DiscoveryRepository()
    doc = await repo.get_report(report_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    return doc


@router.get("/reports/{report_id}/performance")
async def get_report_performance(report_id: str, current_user: CurrentUser) -> dict:
    """Return each pick in the report enriched with the current market price and P&L."""
    import asyncio
    from app.infra.market_data.yfinance_client import YFinanceClient

    repo = DiscoveryRepository()
    doc = await repo.get_report(report_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    picks = doc.get("picks", [])
    symbols = list({p["symbol"] for p in picks})

    client = YFinanceClient()
    results = await asyncio.gather(
        *[client.get_quote(s) for s in symbols], return_exceptions=True
    )
    prices: dict[str, float] = {}
    for sym, r in zip(symbols, results, strict=True):
        if not isinstance(r, Exception):
            prices[sym] = r.price

    def _status(pick: dict, current: float) -> str:
        entry = pick["entry_price"]
        stop  = pick["stop_loss"]
        target = pick.get("target")
        signal = pick.get("signal", "")
        is_long = signal in ("BUY", "STRONG_BUY", "WATCH")
        if target:
            if is_long and current >= target:
                return "TARGET_HIT"
            if not is_long and current <= target:
                return "TARGET_HIT"
        if is_long and current <= stop:
            return "STOP_HIT"
        if not is_long and current >= stop:
            return "STOP_HIT"
        if current > entry * 1.001:
            return "ABOVE_ENTRY"
        if current < entry * 0.999:
            return "BELOW_ENTRY"
        return "AT_ENTRY"

    enriched = []
    for pick in picks:
        current = prices.get(pick["symbol"])
        entry = pick["entry_price"]
        pnl_pct = round((current - entry) / entry * 100, 2) if current else None
        enriched.append({
            **pick,
            "current_price": current,
            "pnl_pct": pnl_pct,
            "status": _status(pick, current) if current else "NO_DATA",
        })

    return {
        "id": doc["id"],
        "generated_at": doc["generated_at"],
        "scanned_count": doc["scanned_count"],
        "picks": enriched,
    }


def _universe_size() -> int:
    try:
        from app.infra.discovery.universe import NSE_UNIVERSE
        return len(NSE_UNIVERSE)
    except Exception:
        return 0
