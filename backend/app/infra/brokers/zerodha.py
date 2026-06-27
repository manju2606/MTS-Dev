"""Zerodha Kite Connect broker adapter.

Requires: pip install kiteconnect
Set KITE_API_KEY and KITE_API_SECRET in .env.
Flow:
  1. GET /broker/zerodha/login-url  → redirect user to Kite login
  2. POST /broker/zerodha/connect { request_token } → stores access token
  3. Live orders now route through Kite.
"""

from __future__ import annotations

import asyncio
from functools import partial
from uuid import UUID

import structlog

from app.domain.interfaces.broker import AbstractBroker
from app.domain.models.order import LiveOrder

log = structlog.get_logger()


def _kite_exchange(exchange: str) -> str:
    return "BSE" if exchange.upper() in ("BSE", "BO") else "NSE"


def _strip_suffix(symbol: str) -> str:
    return symbol.replace(".NS", "").replace(".BO", "").upper()


class ZerodhaBroker(AbstractBroker):
    def __init__(self, api_key: str, access_token: str) -> None:
        try:
            from kiteconnect import KiteConnect  # type: ignore[import-untyped]

            self._kite = KiteConnect(api_key=api_key)
            self._kite.set_access_token(access_token)
        except ImportError as exc:
            raise RuntimeError(
                "kiteconnect not installed. Run: pip install kiteconnect"
            ) from exc
        self._connected = True
        self._orders: dict[str, LiveOrder] = {}

    @property
    def name(self) -> str:
        return "zerodha"

    @property
    def is_connected(self) -> bool:
        return self._connected

    @staticmethod
    def login_url(api_key: str) -> str:
        try:
            from kiteconnect import KiteConnect  # type: ignore[import-untyped]

            return str(KiteConnect(api_key=api_key).login_url())
        except ImportError as exc:
            raise RuntimeError("kiteconnect not installed") from exc

    @staticmethod
    def generate_session(api_key: str, api_secret: str, request_token: str) -> str:
        try:
            from kiteconnect import KiteConnect  # type: ignore[import-untyped]

            kite = KiteConnect(api_key=api_key)
            data = kite.generate_session(request_token, api_secret=api_secret)
            return str(data["access_token"])
        except ImportError as exc:
            raise RuntimeError("kiteconnect not installed") from exc

    def _place_sync(self, symbol: str, exchange: str, signal: str, quantity: int) -> str:
        from kiteconnect import KiteConnect  # type: ignore[import-untyped]

        buy = KiteConnect.TRANSACTION_TYPE_BUY
        sell = KiteConnect.TRANSACTION_TYPE_SELL
        txn = buy if signal == "BUY" else sell
        order_id = self._kite.place_order(
            variety=KiteConnect.VARIETY_REGULAR,
            exchange=_kite_exchange(exchange),
            tradingsymbol=_strip_suffix(symbol),
            transaction_type=txn,
            quantity=quantity,
            product=KiteConnect.PRODUCT_MIS,
            order_type=KiteConnect.ORDER_TYPE_MARKET,
        )
        return str(order_id)

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
        loop = asyncio.get_event_loop()
        broker_order_id = await loop.run_in_executor(
            None, partial(self._place_sync, symbol, exchange, signal, quantity)
        )
        log.info("zerodha.order.placed", symbol=symbol, signal=signal, oid=broker_order_id)
        order = LiveOrder(
            user_id=UUID(user_id),
            symbol=symbol,
            exchange=exchange,
            signal=signal,
            quantity=quantity,
            order_type="MARKET",
            broker="zerodha",
            broker_order_id=broker_order_id,
            status="open",
        )
        self._orders[broker_order_id] = order
        return order

    async def cancel_order(self, broker_order_id: str) -> bool:
        try:
            from kiteconnect import KiteConnect  # type: ignore[import-untyped]

            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                partial(
                    self._kite.cancel_order,
                    variety=KiteConnect.VARIETY_REGULAR,
                    order_id=broker_order_id,
                ),
            )
            if broker_order_id in self._orders:
                self._orders[broker_order_id].status = "cancelled"
            return True
        except Exception as exc:
            log.error("zerodha.cancel.failed", order_id=broker_order_id, error=str(exc))
            return False

    async def get_order(self, broker_order_id: str) -> LiveOrder | None:
        return self._orders.get(broker_order_id)

    async def get_positions(self) -> list[dict]:
        loop = asyncio.get_event_loop()
        try:
            data = await loop.run_in_executor(None, self._kite.positions)
            return list(data.get("net", []))  # type: ignore[union-attr]
        except Exception:
            return []


def get_login_url(api_key: str) -> str:
    return ZerodhaBroker.login_url(api_key)


def connect(api_key: str, api_secret: str, request_token: str) -> ZerodhaBroker:
    access_token = ZerodhaBroker.generate_session(api_key, api_secret, request_token)
    return ZerodhaBroker(api_key=api_key, access_token=access_token)
