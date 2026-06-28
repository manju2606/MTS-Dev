"""Price alerts — in-memory store; alerts persist for the server lifetime."""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, MarketDataDep

router = APIRouter(prefix="/alerts", tags=["alerts"])


@dataclass
class AlertRule:
    user_id: str
    symbol: str
    price_target: float
    direction: str          # "above" | "below"
    id: str = field(default_factory=lambda: str(uuid4()))
    created_at: datetime = field(default_factory=datetime.utcnow)
    triggered: bool = False
    triggered_at: datetime | None = None
    triggered_price: float | None = None


# module-level store: user_id → list[AlertRule]
_store: dict[str, list[AlertRule]] = {}


def _user_alerts(user_id: str) -> list[AlertRule]:
    return _store.setdefault(user_id, [])


def _alert_dict(a: AlertRule) -> dict:
    return {
        "id": a.id,
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
async def list_alerts(current_user: CurrentUser) -> list[dict]:
    return [_alert_dict(a) for a in _user_alerts(str(current_user.id))]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_alert(
    body: CreateAlertRequest,
    current_user: CurrentUser,
) -> dict:
    if body.direction not in ("above", "below"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="direction must be 'above' or 'below'",
        )
    symbol = body.symbol.upper()
    if not (symbol.endswith(".NS") or symbol.endswith(".BO")):
        symbol = f"{symbol}.NS"
    alert = AlertRule(
        user_id=str(current_user.id),
        symbol=symbol,
        price_target=body.price_target,
        direction=body.direction,
    )
    _user_alerts(str(current_user.id)).append(alert)
    return _alert_dict(alert)


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(alert_id: str, current_user: CurrentUser) -> None:
    alerts = _user_alerts(str(current_user.id))
    before = len(alerts)
    _store[str(current_user.id)] = [a for a in alerts if a.id != alert_id]
    if len(_store[str(current_user.id)]) == before:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")


@router.post("/check")
async def check_alerts(
    current_user: CurrentUser,
    market_data: MarketDataDep,
) -> list[dict]:
    """Check all untriggered alerts against current market prices."""
    uid = str(current_user.id)
    alerts = [a for a in _user_alerts(uid) if not a.triggered]
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
            triggered.append(_alert_dict(alert))

    return triggered
