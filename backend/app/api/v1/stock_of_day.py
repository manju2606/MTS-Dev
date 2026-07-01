"""Stock-of-the-Day API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import CurrentUser, require_role
from app.domain.models.user import UserRole
from app.infra.db.repositories.stock_of_day_repo import StockOfDayRepository

router = APIRouter(prefix="/stock-of-day", tags=["stock-of-day"])

_admin_only = Depends(require_role(UserRole.ADMIN))


def _serialize(s: object) -> dict:
    from app.domain.models.stock_of_day import StockOfDay
    d: StockOfDay = s  # type: ignore[assignment]
    return {
        "id": d.id,
        "date": d.date,
        "generated_at": d.generated_at,
        "symbol": d.symbol,
        "name": d.name,
        "sector": d.sector,
        "discovery_score": d.discovery_score,
        "discovery_signal": d.discovery_signal,
        "scanner_hits": d.scanner_hits,
        "forecast_direction": d.forecast_direction,
        "composite_score": d.composite_score,
        "confidence": d.confidence,
        "entry_price": d.entry_price,
        "stop_loss": d.stop_loss,
        "target": d.target,
        "risk_reward": d.risk_reward,
        "holding_period": d.holding_period,
        "explanation": d.explanation,
        "auto_traded": d.auto_traded,
        "paper_trade_id": d.paper_trade_id,
        "quantity": d.quantity,
        "status": d.status,
        "exit_price": d.exit_price,
        "exit_time": d.exit_time,
        "pnl_pct": d.pnl_pct,
        "outcome": d.outcome,
    }


@router.get("/today")
async def get_today(_: CurrentUser) -> dict:
    """Return today's Stock of the Day pick (null if not yet generated)."""
    from datetime import datetime, timezone, timedelta
    IST = timezone(timedelta(hours=5, minutes=30))
    today = datetime.now(IST).strftime("%Y-%m-%d")
    repo = StockOfDayRepository()
    sotd = await repo.get_by_date(today)
    if sotd is None:
        return {"data": None, "today": today}
    return {"data": _serialize(sotd), "today": today}


@router.get("/history")
async def get_history(
    _: CurrentUser,
    limit: int = Query(default=30, ge=1, le=100),
) -> list[dict]:
    """Return historical SotD picks sorted newest-first."""
    repo = StockOfDayRepository()
    items = await repo.list_history(limit)
    return [_serialize(s) for s in items]


@router.get("/journal/{date_str}")
async def get_journal(date_str: str, _: CurrentUser) -> list[dict]:
    """Return journal events for a specific date."""
    repo = StockOfDayRepository()
    return await repo.get_journal(date_str)


@router.post("/generate", dependencies=[_admin_only])
async def trigger_generate(_: CurrentUser) -> dict:
    """Manually trigger today's SotD pick generation (admin only)."""
    from datetime import datetime, timezone, timedelta
    IST = timezone(timedelta(hours=5, minutes=30))
    today = datetime.now(IST).strftime("%Y-%m-%d")

    # Delete existing pick for today so it can regenerate
    from app.infra.db.repositories.stock_of_day_repo import _get_db
    db = _get_db()
    await db["stock_of_day"].delete_one({"date": today})

    from app.services.stock_of_day_service import generate_and_save_daily_pick
    sotd = await generate_and_save_daily_pick()
    if sotd is None:
        raise HTTPException(status_code=503, detail="No candidates found — run a discovery scan first")
    return _serialize(sotd)


@router.post("/check-positions", dependencies=[_admin_only])
async def trigger_price_check(_: CurrentUser) -> dict:
    """Manually trigger a SL/target price check for TRADING picks (admin only)."""
    from app.services.stock_of_day_service import run_sotd_price_check
    await run_sotd_price_check()
    return {"ok": True}
