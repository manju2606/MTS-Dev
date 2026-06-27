"""Simulated live broker — executes at yfinance last price, no external connection."""

import asyncio
from datetime import datetime
from functools import partial
from uuid import UUID

import yfinance as yf

from app.domain.interfaces.broker import AbstractBroker
from app.domain.models.order import LiveOrder


def _fetch_price_sync(symbol: str) -> float:
    ticker = yf.Ticker(symbol)
    info = ticker.fast_info
    price = getattr(info, "last_price", None) or getattr(info, "previous_close", None)
    if not price:
        hist = ticker.history(period="1d")
        if hist.empty:
            raise ValueError(f"No price data for {symbol}")
        price = float(hist["Close"].iloc[-1])
    return float(price)


class SimulatedBroker(AbstractBroker):
    """Fills orders instantly at current market price — useful without Kite credentials."""

    def __init__(self) -> None:
        self._orders: dict[str, LiveOrder] = {}

    @property
    def name(self) -> str:
        return "simulated"

    @property
    def is_connected(self) -> bool:
        return True

    async def place_order(
        self,
        user_id: str,
        symbol: str,
        exchange: str,
        signal: str,
        quantity: int,
        order_type: str = "MARKET",
        price: float | None = None,
    ) -> LiveOrder:
        if order_type == "MARKET":
            loop = asyncio.get_event_loop()
            fill_price = await loop.run_in_executor(None, partial(_fetch_price_sync, symbol))
        else:
            if price is None:
                raise ValueError("LIMIT order requires price")
            fill_price = price

        order = LiveOrder(
            user_id=UUID(user_id),
            symbol=symbol,
            exchange=exchange,
            signal=signal,
            quantity=quantity,
            order_type=order_type,
            broker="simulated",
            price=price,
            broker_order_id=None,
            status="filled",
            fill_price=fill_price,
            fill_time=datetime.utcnow(),
        )
        order.broker_order_id = str(order.id)
        self._orders[str(order.id)] = order
        return order

    async def cancel_order(self, broker_order_id: str) -> bool:
        order = self._orders.get(broker_order_id)
        if order and order.status not in ("filled", "cancelled"):
            order.status = "cancelled"
            return True
        return False

    async def get_order(self, broker_order_id: str) -> LiveOrder | None:
        return self._orders.get(broker_order_id)

    async def get_positions(self) -> list[dict]:
        filled = [o for o in self._orders.values() if o.status == "filled"]
        pos: dict[str, dict] = {}
        for o in filled:
            key = f"{o.symbol}_{o.signal}"
            if key not in pos:
                pos[key] = {
                    "symbol": o.symbol,
                    "exchange": o.exchange,
                    "signal": o.signal,
                    "quantity": 0,
                    "avg_price": 0.0,
                }
            p = pos[key]
            total_qty = p["quantity"] + o.quantity
            p["avg_price"] = (
                p["avg_price"] * p["quantity"] + (o.fill_price or 0) * o.quantity
            ) / total_qty
            p["quantity"] = total_qty
        return list(pos.values())
