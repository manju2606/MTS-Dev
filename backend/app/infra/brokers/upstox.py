"""Upstox API v2 broker adapter.

Set UPSTOX_API_KEY, UPSTOX_API_SECRET, UPSTOX_REDIRECT_URI in .env.
OAuth flow:
  1. GET /broker/upstox/login-url  → send user to Upstox login page
  2. Upstox redirects to UPSTOX_REDIRECT_URI?code=…
  3. POST /broker/upstox/connect { code } → exchange code for access_token
"""

from __future__ import annotations

from uuid import UUID

import httpx
import structlog

from app.domain.interfaces.broker import AbstractBroker
from app.domain.models.order import LiveOrder

log = structlog.get_logger()

_TOKEN_URL = "https://api.upstox.com/v2/login/authorization/token"
_ORDER_URL = "https://api.upstox.com/v2/order/place"
_CANCEL_URL = "https://api.upstox.com/v2/order/cancel"
_POSITIONS_URL = "https://api.upstox.com/v2/portfolio/short-term-positions"


def get_login_url(api_key: str, redirect_uri: str) -> str:
    from urllib.parse import urlencode

    params = urlencode(
        {
            "response_type": "code",
            "client_id": api_key,
            "redirect_uri": redirect_uri,
        }
    )
    return f"https://api.upstox.com/v2/login/authorization/dialog?{params}"


async def exchange_code(api_key: str, api_secret: str, code: str, redirect_uri: str) -> str:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            _TOKEN_URL,
            data={
                "code": code,
                "client_id": api_key,
                "client_secret": api_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Accept": "application/json"},
            timeout=15,
        )
        resp.raise_for_status()
        return str(resp.json()["access_token"])


class UpstoxBroker(AbstractBroker):
    def __init__(self, api_key: str, access_token: str) -> None:
        self._api_key = api_key
        self._access_token = access_token
        self._orders: dict[str, LiveOrder] = {}
        self._connected = True

    @property
    def name(self) -> str:
        return "upstox"

    @property
    def is_connected(self) -> bool:
        return self._connected

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._access_token}",
            "Accept": "application/json",
        }

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
        sym_clean = symbol.replace(".NS", "").replace(".BO", "").upper()
        exch = "BSE_EQ" if exchange.upper() in ("BSE", "BO") else "NSE_EQ"
        instrument_key = f"{exch}|{sym_clean}"

        payload = {
            "quantity": quantity,
            "product": "D",
            "validity": "DAY",
            "price": price or 0,
            "tag": "MTS",
            "instrument_token": instrument_key,
            "order_type": "MARKET" if order_type == "MARKET" else "LIMIT",
            "transaction_type": "BUY" if signal.upper() == "BUY" else "SELL",
            "disclosed_quantity": 0,
            "trigger_price": 0,
            "is_amo": False,
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                _ORDER_URL,
                json=payload,
                headers={**self._headers(), "Content-Type": "application/json"},
                timeout=15,
            )
            resp.raise_for_status()
            order_id = str(resp.json()["data"]["order_id"])

        log.info("upstox.order.placed", symbol=symbol, signal=signal, oid=order_id)
        order = LiveOrder(
            user_id=UUID(user_id),
            symbol=symbol,
            exchange=exchange,
            signal=signal,
            quantity=quantity,
            order_type=order_type,
            broker="upstox",
            broker_order_id=order_id,
            status="open",
            price=price,
        )
        self._orders[order_id] = order
        return order

    async def cancel_order(self, broker_order_id: str) -> bool:
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.delete(
                    f"{_CANCEL_URL}?order_id={broker_order_id}",
                    headers=self._headers(),
                    timeout=15,
                )
                resp.raise_for_status()
                if broker_order_id in self._orders:
                    self._orders[broker_order_id].status = "cancelled"
                return True
            except Exception as exc:
                log.error("upstox.cancel.failed", order_id=broker_order_id, error=str(exc))
                return False

    async def get_order(self, broker_order_id: str) -> LiveOrder | None:
        return self._orders.get(broker_order_id)

    async def get_positions(self) -> list[dict]:
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(_POSITIONS_URL, headers=self._headers(), timeout=15)
                resp.raise_for_status()
                data = resp.json().get("data", [])
                return [
                    {
                        "symbol": p.get("tradingsymbol", ""),
                        "exchange": p.get("exchange", ""),
                        "signal": "BUY" if p.get("quantity", 0) >= 0 else "SELL",
                        "quantity": abs(p.get("quantity", 0)),
                        "avg_price": float(p.get("average_price", 0)),
                    }
                    for p in data
                    if abs(p.get("quantity", 0)) > 0
                ]
            except Exception as exc:
                log.error("upstox.positions.failed", error=str(exc))
                return []
