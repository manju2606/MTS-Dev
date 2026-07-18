"""Alice Blue (ANT) API v2 broker adapter.

Set ALICEBLUE_APP_CODE, ALICEBLUE_API_SECRET, ALICEBLUE_REDIRECT_URI in .env.
OAuth-style flow:
  1. GET /broker/aliceblue/login-url  → send user to Ant's login page
  2. Ant redirects to ALICEBLUE_REDIRECT_URI?authCode=...&userId=...
  3. POST /broker/aliceblue/connect { user_id, auth_code } → backend computes
     checksum = sha256(user_id + auth_code + api_secret) and exchanges it for
     a session token via getUserDetails.

Order placement needs Alice Blue's own `instrumentId` for each tradingsymbol
(resolved from their published contract-master file), which this adapter
does not yet fetch/cache -- see place_order below.
"""

from __future__ import annotations

import hashlib
from uuid import UUID

import httpx
import structlog

from app.domain.interfaces.broker import AbstractBroker
from app.domain.models.order import LiveOrder

log = structlog.get_logger()

_BASE_URL = "https://a3.aliceblueonline.com"
_SESSION_URL = f"{_BASE_URL}/open-api/od/v1/vendor/getUserDetails"
_ORDER_URL = f"{_BASE_URL}/open-api/od/v1/orders/placeorder"
_CANCEL_URL = f"{_BASE_URL}/open-api/od/v1/orders/cancel"
_POSITIONS_URL = f"{_BASE_URL}/open-api/od/v1/positions"


def get_login_url(app_code: str) -> str:
    return f"https://ant.aliceblueonline.com/?appcode={app_code}"


async def generate_session(api_secret: str, user_id: str, auth_code: str) -> str:
    """Exchanges (user_id, auth_code) for a userSession token. Raises on
    failure (bad checksum, expired auth_code, etc.)."""
    checksum = hashlib.sha256(f"{user_id}{auth_code}{api_secret}".encode()).hexdigest()
    async with httpx.AsyncClient() as client:
        resp = await client.post(_SESSION_URL, json={"checkSum": checksum}, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if data.get("stat") != "Ok" or not data.get("userSession"):
            raise RuntimeError(data.get("emsg") or "Alice Blue session generation failed")
        return str(data["userSession"])


class AliceBlueBroker(AbstractBroker):
    def __init__(self, client_id: str, user_session: str) -> None:
        self._client_id = client_id
        self._user_session = user_session
        self._orders: dict[str, LiveOrder] = {}
        self._connected = True

    @property
    def name(self) -> str:
        return "aliceblue"

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def credentials(self) -> dict[str, str]:
        return {"client_id": self._client_id, "user_session": self._user_session}

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._client_id} {self._user_session}",
            "Content-Type": "application/json",
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
        # NOTE: Alice Blue identifies instruments by their own numeric
        # `instrumentId` (from their contract-master file), not by trading
        # symbol -- passing the raw symbol here will be rejected until that
        # lookup is added. Left as-is (rather than faked) so it fails loudly.
        sym_clean = symbol.replace(".NS", "").replace(".BO", "").upper()
        payload = {
            "exchange": "BSE" if exchange.upper() in ("BSE", "BO") else "NSE",
            "instrumentId": sym_clean,
            "transactionType": "BUY" if signal.upper() == "BUY" else "SELL",
            "quantity": quantity,
            "product": "INTRADAY",
            "orderComplexity": "REGULAR",
            "orderType": "MARKET" if order_type == "MARKET" else "LIMIT",
            "validity": "DAY",
        }
        if price:
            payload["price"] = str(price)

        async with httpx.AsyncClient() as client:
            resp = await client.post(_ORDER_URL, json=payload, headers=self._headers(), timeout=15)
            resp.raise_for_status()
            data = resp.json()
            order_id = str(data.get("brokerOrderId") or data.get("orderId"))

        log.info("aliceblue.order.placed", symbol=symbol, signal=signal, oid=order_id)
        order = LiveOrder(
            user_id=UUID(user_id),
            symbol=symbol,
            exchange=exchange,
            signal=signal,
            quantity=quantity,
            order_type=order_type,
            broker="aliceblue",
            broker_order_id=order_id,
            status="open",
            price=price,
        )
        self._orders[order_id] = order
        return order

    async def cancel_order(self, broker_order_id: str) -> bool:
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    _CANCEL_URL,
                    json={"brokerOrderId": broker_order_id},
                    headers=self._headers(),
                    timeout=15,
                )
                resp.raise_for_status()
                if broker_order_id in self._orders:
                    self._orders[broker_order_id].status = "cancelled"
                return True
            except Exception as exc:
                log.error("aliceblue.cancel.failed", order_id=broker_order_id, error=str(exc))
                return False

    async def get_order(self, broker_order_id: str) -> LiveOrder | None:
        return self._orders.get(broker_order_id)

    async def get_positions(self) -> list[dict]:
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(_POSITIONS_URL, headers=self._headers(), timeout=15)
                resp.raise_for_status()
                data = resp.json()
                rows = data if isinstance(data, list) else data.get("data", [])
                return [
                    {
                        "symbol": p.get("symbol") or p.get("tradingSymbol", ""),
                        "exchange": p.get("exchange", ""),
                        "signal": "BUY" if float(p.get("netQty", 0)) >= 0 else "SELL",
                        "quantity": abs(float(p.get("netQty", 0))),
                        "avg_price": float(p.get("avgPrice", 0)),
                    }
                    for p in rows
                    if float(p.get("netQty", 0)) != 0
                ]
            except Exception as exc:
                log.error("aliceblue.positions.failed", error=str(exc))
                return []
