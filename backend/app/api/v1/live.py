"""Live trading endpoints — routes orders through the user's connected broker."""

import asyncio
from dataclasses import asdict
from datetime import datetime
from functools import partial

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, RiskDep, require_role
from app.domain.models.order import LiveOrder
from app.domain.models.user import UserRole
from app.infra.brokers import session_store
from app.infra.brokers.simulated import SimulatedBroker
from app.infra.db.repositories.order_repo import OrderRepository

router = APIRouter(prefix="/live", tags=["live-trading"])

_trader_or_admin = Depends(require_role(UserRole.ADMIN, UserRole.TRADER))


def _get_broker(user_id: str):
    broker = session_store.get(user_id)
    return broker if broker is not None else SimulatedBroker()


def _serialize_order(order: LiveOrder) -> dict:
    d = asdict(order)
    d["id"] = str(d["id"])
    d["user_id"] = str(d["user_id"])
    if d.get("fill_time") and isinstance(d["fill_time"], datetime):
        d["fill_time"] = d["fill_time"].isoformat()
    d["created_at"] = order.created_at.isoformat()
    return d


class PlaceOrderRequest(BaseModel):
    symbol: str
    signal: str        # BUY | SELL
    quantity: int
    order_type: str = "MARKET"
    price: float | None = None
    stop_loss: float | None = None
    target: float | None = None


@router.post("/orders", status_code=status.HTTP_201_CREATED, dependencies=[_trader_or_admin])
async def place_live_order(
    body: PlaceOrderRequest,
    current_user: CurrentUser,
    risk_engine: RiskDep,
) -> dict:
    signal = body.signal.upper()
    if signal not in ("BUY", "SELL"):
        raise HTTPException(status_code=400, detail="signal must be BUY or SELL")

    if body.stop_loss and body.target and body.price:
        risk = risk_engine.validate_trade(
            signal=signal,
            entry=body.price,
            stop_loss=body.stop_loss,
            target=body.target,
            quantity=body.quantity,
        )
        if not risk.passed:
            raise HTTPException(
                status_code=422, detail="Risk check failed: " + "; ".join(risk.violations)
            )

    sym = body.symbol.upper()
    exchange = "BSE" if sym.endswith(".BO") else "NSE"
    broker = _get_broker(str(current_user.id))

    try:
        order = await broker.place_order(
            user_id=str(current_user.id),
            symbol=sym,
            exchange=exchange,
            signal=signal,
            quantity=body.quantity,
            order_type=body.order_type,
            price=body.price,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Broker error: {exc}") from exc

    repo = OrderRepository()
    await repo.save(order)

    from app.infra.webhooks.dispatcher import fire as wh_fire
    wh_fire("trade.executed", {
        "symbol": order.symbol, "signal": signal, "quantity": body.quantity,
        "broker": broker.name, "order_type": body.order_type,
    })

    return _serialize_order(order)


@router.get("/orders")
async def list_orders(current_user: CurrentUser) -> list[dict]:
    repo = OrderRepository()
    orders = await repo.list_by_user(str(current_user.id))
    if orders:
        return [_serialize_order(o) for o in orders]
    # Fall back to in-memory (for simulated broker in same session)
    broker = _get_broker(str(current_user.id))
    if hasattr(broker, "_orders"):
        return [_serialize_order(o) for o in broker._orders.values()]
    return []


@router.delete("/orders/{broker_order_id}", dependencies=[_trader_or_admin])
async def cancel_order(broker_order_id: str, current_user: CurrentUser) -> dict:
    broker = _get_broker(str(current_user.id))
    cancelled = await broker.cancel_order(broker_order_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="Order not found or already terminal")
    repo = OrderRepository()
    await repo.update_status(broker_order_id, "cancelled")
    return {"cancelled": True, "broker_order_id": broker_order_id}


@router.get("/positions")
async def positions(current_user: CurrentUser) -> list[dict]:
    broker = _get_broker(str(current_user.id))
    pos = await broker.get_positions()
    if not pos:
        return []

    # Enrich with live price and unrealised P&L
    import yfinance as yf

    async def _enrich(p: dict) -> dict:
        sym = p.get("symbol", "")
        avg = float(p.get("avg_price", 0))
        qty = int(p.get("quantity", 0))
        try:
            loop = asyncio.get_event_loop()
            ticker_sym = sym if sym.endswith((".NS", ".BO")) else f"{sym}.NS"
            info = await loop.run_in_executor(
                None, partial(lambda s: yf.Ticker(s).fast_info, ticker_sym)
            )
            ltp = float(getattr(info, "last_price", None) or getattr(info, "previous_close", None) or avg)
        except Exception:
            ltp = avg
        signal = p.get("signal", "BUY")
        pnl = (ltp - avg) * qty if signal == "BUY" else (avg - ltp) * qty
        pnl_pct = (pnl / (avg * qty) * 100) if avg * qty > 0 else 0.0
        return {**p, "ltp": round(ltp, 2), "pnl": round(pnl, 2), "pnl_pct": round(pnl_pct, 2)}

    enriched = await asyncio.gather(*[_enrich(p) for p in pos], return_exceptions=True)
    return [e for e in enriched if isinstance(e, dict)]


@router.get("/pnl")
async def pnl(current_user: CurrentUser) -> dict:
    broker = _get_broker(str(current_user.id))
    pos_raw = await broker.get_positions()
    total_value = sum(p.get("quantity", 0) * p.get("avg_price", 0) for p in pos_raw)
    return {
        "broker": broker.name,
        "open_positions": len(pos_raw),
        "total_invested": round(total_value, 2),
    }
