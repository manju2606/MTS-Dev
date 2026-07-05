"""Price alerts — persisted to PostgreSQL via AlertRepository."""

import asyncio
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import AlertDep, CurrentUser, MarketDataDep, require_role
from app.domain.models.alert import Alert
from app.domain.models.user import UserRole

router = APIRouter(prefix="/alerts", tags=["alerts"])

_trader_or_admin = require_role(UserRole.ADMIN, UserRole.TRADER)


def _alert_dict(a: Alert) -> dict:
    return {
        "id": str(a.id),
        "symbol": a.symbol,
        "price_target": a.price_target,
        "direction": a.direction,
        "triggered": a.triggered,
        "triggered_at": a.triggered_at.isoformat() if a.triggered_at else None,
        "triggered_price": a.triggered_price,
        "created_at": a.created_at.isoformat(),
    }


class CreateAlertRequest(BaseModel):
    symbol: str
    price_target: float
    direction: str   # "above" | "below"


@router.get("")
async def list_alerts(current_user: CurrentUser, repo: AlertDep) -> list[dict]:
    alerts = await repo.list_by_user(current_user.id)
    return [_alert_dict(a) for a in alerts]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_alert(
    body: CreateAlertRequest,
    current_user: CurrentUser,
    repo: AlertDep,
) -> dict:
    if current_user.role not in (UserRole.ADMIN, UserRole.TRADER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Traders and admins only")
    if body.direction not in ("above", "below"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="direction must be 'above' or 'below'",
        )
    symbol = body.symbol.upper()
    if not (symbol.endswith(".NS") or symbol.endswith(".BO")):
        symbol = f"{symbol}.NS"
    alert = Alert(
        user_id=current_user.id,
        symbol=symbol,
        price_target=body.price_target,
        direction=body.direction,
    )
    created = await repo.create(alert)
    return _alert_dict(created)


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(alert_id: str, current_user: CurrentUser, repo: AlertDep) -> None:
    if current_user.role not in (UserRole.ADMIN, UserRole.TRADER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Traders and admins only")
    from uuid import UUID
    try:
        uid = UUID(alert_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    deleted = await repo.delete(uid, current_user.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")


@router.post("/check")
async def check_alerts(
    current_user: CurrentUser,
    repo: AlertDep,
    market_data: MarketDataDep,
) -> list[dict]:
    """Check all untriggered alerts for this user against current market prices."""
    alerts = [a for a in await repo.list_by_user(current_user.id) if not a.triggered]
    if not alerts:
        return []

    symbols = list({a.symbol for a in alerts})
    results = await asyncio.gather(
        *[market_data.get_quote(s) for s in symbols], return_exceptions=True
    )
    prices: dict[str, float] = {}
    for sym, r in zip(symbols, results, strict=True):
        if not isinstance(r, Exception):
            prices[sym] = r.price

    triggered = []
    for alert in alerts:
        price = prices.get(alert.symbol)
        if price is None:
            continue
        hit = (
            (alert.direction == "above" and price >= alert.price_target)
            or (alert.direction == "below" and price <= alert.price_target)
        )
        if hit:
            alert.triggered = True
            alert.triggered_at = datetime.utcnow()
            alert.triggered_price = price
            updated = await repo.update(alert)
            triggered.append(_alert_dict(updated))
            from app.infra.notifications.push import fire as notif_fire
            from app.infra.webhooks.dispatcher import fire as wh_fire
            wh_fire("alert.triggered", {
                "symbol": alert.symbol, "direction": alert.direction,
                "price_target": alert.price_target, "triggered_price": price,
            })
            notif_fire(
                str(alert.user_id),
                "alert.triggered",
                f"Price alert: {alert.symbol}",
                f"{alert.symbol} hit ₹{price:.2f} ({alert.direction} ₹{alert.price_target:.2f})",
                "/alerts",
            )

    return triggered


# ── Position monitoring alerts (still in-memory, from position_monitor.py) ───

def _pos_dict(a) -> dict:  # type: ignore[no-untyped-def]
    return {
        "id": a.id,
        "trade_id": a.trade_id,
        "symbol": a.symbol,
        "signal": a.signal,
        "event": a.event,
        "entry_price": a.entry_price,
        "stop_loss": a.stop_loss,
        "target": a.target,
        "trigger_price": a.trigger_price,
        "quantity": a.quantity,
        "pnl_estimate": a.pnl_estimate,
        "triggered_at": a.triggered_at.isoformat(),
        "acknowledged": a.acknowledged,
    }


@router.get("/positions")
async def list_position_alerts(current_user: CurrentUser) -> list[dict]:
    from app.infra.monitoring.position_monitor import get_position_alerts
    return [_pos_dict(a) for a in get_position_alerts(str(current_user.id))]


@router.post("/positions/{alert_id}/ack")
async def ack_position_alert(alert_id: str, current_user: CurrentUser) -> dict:
    from app.infra.monitoring.position_monitor import ack_position_alert as _ack
    if not _ack(str(current_user.id), alert_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    return {"ok": True}


@router.delete("/positions/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def clear_position_alert(alert_id: str, current_user: CurrentUser) -> None:
    from app.infra.monitoring.position_monitor import clear_position_alert as _clear
    if not _clear(str(current_user.id), alert_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
