"""Chartink scan-alert webhook receiver + read endpoints.

POST /chartink/webhook is hit directly by Chartink's own servers (no user
session), so it's secret-gated the same way Alertmanager's webhook is (see
alerting.py) rather than JWT-authenticated. The GET endpoints below are for
the (future) dashboard -- see services/chartink_signal_service.py for the
scoring pipeline this triggers.
"""

from fastapi import APIRouter, Body, Header, HTTPException, Query, status

from app.api.deps import CurrentUser, DBSession
from app.domain.models.chartink_candidate import ChartinkCandidate

router = APIRouter(prefix="/chartink", tags=["chartink"])


def _candidate_dict(c: ChartinkCandidate) -> dict:
    return {
        "id": str(c.id),
        "scan_name": c.scan_name,
        "symbol": c.symbol,
        "trigger_price": c.trigger_price,
        "signal": c.signal,
        "confidence": c.confidence,
        "entry_price": c.entry_price,
        "stop_loss": c.stop_loss,
        "target": c.target,
        "risk_reward_ratio": c.risk_reward_ratio,
        "holding_period": c.holding_period,
        "explanation": c.explanation,
        "rsi": c.rsi,
        "adx": c.adx,
        "volume_ratio": c.volume_ratio,
        "received_at": c.received_at.isoformat(),
    }


@router.post("/webhook")
async def chartink_webhook(
    body: dict = Body(...),
    authorization: str | None = Header(default=None),
) -> dict:
    import structlog

    from app.core.config import settings

    log = structlog.get_logger()

    if settings.CHARTINK_WEBHOOK_SECRET:
        expected = f"Bearer {settings.CHARTINK_WEBHOOK_SECRET}"
        if authorization != expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook secret"
            )
    else:
        log.warning(
            "chartink.webhook.no_secret_configured",
            hint="Set CHARTINK_WEBHOOK_SECRET to prevent unauthenticated callers "
            "from injecting fake candidates (this endpoint is proxied publicly "
            "along with the rest of /api/).",
        )

    stocks = [s.strip() for s in str(body.get("stocks", "")).split(",") if s.strip()]
    if not stocks:
        return {"received": 0, "scored": 0}

    raw_prices = [p.strip() for p in str(body.get("trigger_prices", "")).split(",")]
    trigger_prices: list[float] = []
    for p in raw_prices:
        try:
            trigger_prices.append(float(p))
        except ValueError:
            trigger_prices.append(0.0)
    if len(trigger_prices) < len(stocks):
        trigger_prices += [0.0] * (len(stocks) - len(trigger_prices))

    symbols = [f"{s}.NS" for s in stocks]
    scan_name = str(body.get("scan_name") or body.get("alert_name") or "Chartink Scan")
    triggered_at = str(body.get("triggered_at") or "")

    from app.services.chartink_signal_service import process_chartink_alert

    candidates = await process_chartink_alert(scan_name, symbols, trigger_prices, triggered_at)

    log.info(
        "chartink.webhook.processed",
        scan_name=scan_name,
        received=len(symbols),
        scored=len(candidates),
    )
    return {"received": len(symbols), "scored": len(candidates)}


@router.get("/candidates")
async def list_candidates(
    current_user: CurrentUser,
    db: DBSession,
    scan_name: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    from app.infra.db.repositories.chartink_repo import SQLChartinkCandidateRepository

    repo = SQLChartinkCandidateRepository(db)
    candidates = await repo.list_recent(scan_name=scan_name, limit=limit)
    return [_candidate_dict(c) for c in candidates]


@router.get("/today")
async def list_today(current_user: CurrentUser, db: DBSession) -> list[dict]:
    from app.infra.db.repositories.chartink_repo import SQLChartinkCandidateRepository

    repo = SQLChartinkCandidateRepository(db)
    candidates = await repo.list_today()
    return [_candidate_dict(c) for c in candidates]
