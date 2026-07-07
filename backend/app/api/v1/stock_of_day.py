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
    from datetime import datetime, timedelta, timezone

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
    from datetime import datetime, timedelta, timezone

    IST = timezone(timedelta(hours=5, minutes=30))
    today = datetime.now(IST).strftime("%Y-%m-%d")

    # Delete existing pick for today so it can regenerate
    from app.infra.db.repositories.stock_of_day_repo import _get_db

    db = _get_db()
    await db["stock_of_day"].delete_one({"date": today})

    from app.services.stock_of_day_service import generate_and_save_daily_pick

    sotd = await generate_and_save_daily_pick()
    if sotd is None:
        raise HTTPException(
            status_code=503, detail="No candidates found — run a discovery scan first"
        )
    return _serialize(sotd)


@router.post("/check-positions", dependencies=[_admin_only])
async def trigger_price_check(_: CurrentUser) -> dict:
    """Manually trigger a SL/target price check for TRADING picks (admin only)."""
    from app.services.stock_of_day_service import run_sotd_price_check

    await run_sotd_price_check()
    return {"ok": True}


def _settings_dict(cfg) -> dict:  # type: ignore[type-arg]
    return {
        "auto_trade_enabled": cfg.auto_trade_enabled,
        "threshold": cfg.threshold,
        "max_daily_trades": cfg.max_daily_trades,
        "market_hours_only": cfg.market_hours_only,
        "paper_trade_quantity": cfg.paper_trade_quantity,
        "quantity_type": cfg.quantity_type,
        "paper_capital": cfg.paper_capital,
    }


@router.get("/settings")
async def get_settings(_: CurrentUser) -> dict:
    """Return current SotD auto-trade settings."""
    repo = StockOfDayRepository()
    return _settings_dict(await repo.get_settings())


@router.put("/settings", dependencies=[_admin_only])
async def update_settings(body: dict, _: CurrentUser) -> dict:
    """Update SotD auto-trade settings (admin only)."""
    from app.domain.models.stock_of_day import SotDSettings

    repo = StockOfDayRepository()
    existing = await repo.get_settings()
    qty_type = str(body.get("quantity_type", existing.quantity_type))
    if qty_type not in ("qty", "pct"):
        raise HTTPException(status_code=422, detail="quantity_type must be 'qty' or 'pct'")
    updated = SotDSettings(
        auto_trade_enabled=bool(body.get("auto_trade_enabled", existing.auto_trade_enabled)),
        threshold=float(body.get("threshold", existing.threshold)),
        max_daily_trades=int(body.get("max_daily_trades", existing.max_daily_trades)),
        market_hours_only=bool(body.get("market_hours_only", existing.market_hours_only)),
        paper_trade_quantity=float(body.get("paper_trade_quantity", existing.paper_trade_quantity)),
        quantity_type=qty_type,
        paper_capital=float(body.get("paper_capital", existing.paper_capital)),
    )
    if not (50 <= updated.threshold <= 100):
        raise HTTPException(status_code=422, detail="threshold must be between 50 and 100")
    if not (1 <= updated.max_daily_trades <= 10):
        raise HTTPException(status_code=422, detail="max_daily_trades must be between 1 and 10")
    if updated.quantity_type == "qty" and not (1 <= updated.paper_trade_quantity <= 10000):
        raise HTTPException(
            status_code=422, detail="paper_trade_quantity must be between 1 and 10000 for qty mode"
        )
    if updated.quantity_type == "pct" and not (0.1 <= updated.paper_trade_quantity <= 100):
        raise HTTPException(
            status_code=422, detail="paper_trade_quantity must be between 0.1 and 100 for pct mode"
        )
    if not (1000 <= updated.paper_capital <= 100_000_000):
        raise HTTPException(
            status_code=422, detail="paper_capital must be between ₹1,000 and ₹10,00,00,000"
        )
    return _settings_dict(await repo.save_settings(updated))
