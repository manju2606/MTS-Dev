"""DhanHQ v2 API broker adapter.

Unlike Zerodha/Upstox/Alice Blue, Dhan has no app-registration or redirect
login for individual traders -- the user generates their own access_token
(a JWT, valid 24h) from web.dhan.co under My Profile → Access DhanHQ APIs,
and pastes it here alongside their Dhan client ID. No backend .env config
needed; both values are per-user credentials entered on the Broker page,
same shape as Zerodha's request_token paste but with no exchange step.

Order placement needs Dhan's own `securityId` for each tradingsymbol
(resolved from their published scrip-master file), which this adapter does
not yet fetch/cache -- see place_order below.
"""

from __future__ import annotations

from uuid import UUID

import httpx
import structlog

from app.domain.interfaces.broker import AbstractBroker
from app.domain.models.order import LiveOrder

log = structlog.get_logger()

_BASE_URL = "https://api.dhan.co/v2"
_ORDER_URL = f"{_BASE_URL}/orders"
_POSITIONS_URL = f"{_BASE_URL}/positions"


async def validate_credentials(client_id: str, access_token: str) -> bool:
    """Cheap check that (client_id, access_token) actually work before we
    store them -- hits /positions since Dhan has no dedicated profile/ping
    endpoint documented."""
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                _POSITIONS_URL,
                headers={"access-token": access_token, "dhanClientId": client_id},
                timeout=15,
            )
            return resp.status_code == 200
        except Exception:
            return False


class DhanBroker(AbstractBroker):
    def __init__(self, client_id: str, access_token: str) -> None:
        self._client_id = client_id
        self._access_token = access_token
        self._orders: dict[str, LiveOrder] = {}
        self._connected = True

    @property
    def name(self) -> str:
        return "dhan"

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def credentials(self) -> dict[str, str]:
        return {"client_id": self._client_id, "access_token": self._access_token}

    def _headers(self) -> dict:
        return {
            "access-token": self._access_token,
            "dhanClientId": self._client_id,
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
        # NOTE: Dhan identifies instruments by their own numeric `securityId`
        # (from their scrip-master CSV), not by trading symbol -- passing the
        # raw symbol here will be rejected until that lookup is added. Left
        # as-is (rather than faked) so it fails loudly.
        sym_clean = symbol.replace(".NS", "").replace(".BO", "").upper()
        payload = {
            "dhanClientId": self._client_id,
            "transactionType": "BUY" if signal.upper() == "BUY" else "SELL",
            "exchangeSegment": "BSE_EQ" if exchange.upper() in ("BSE", "BO") else "NSE_EQ",
            "productType": "INTRADAY",
            "orderType": "MARKET" if order_type == "MARKET" else "LIMIT",
            "validity": "DAY",
            "securityId": sym_clean,
            "quantity": quantity,
            "disclosedQuantity": 0,
            "price": price or 0,
            "triggerPrice": 0,
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(_ORDER_URL, json=payload, headers=self._headers(), timeout=15)
            resp.raise_for_status()
            order_id = str(resp.json()["orderId"])

        log.info("dhan.order.placed", symbol=symbol, signal=signal, oid=order_id)
        order = LiveOrder(
            user_id=UUID(user_id),
            symbol=symbol,
            exchange=exchange,
            signal=signal,
            quantity=quantity,
            order_type=order_type,
            broker="dhan",
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
                    f"{_ORDER_URL}/{broker_order_id}", headers=self._headers(), timeout=15
                )
                resp.raise_for_status()
                if broker_order_id in self._orders:
                    self._orders[broker_order_id].status = "cancelled"
                return True
            except Exception as exc:
                log.error("dhan.cancel.failed", order_id=broker_order_id, error=str(exc))
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
                        "symbol": p.get("tradingSymbol", ""),
                        "exchange": p.get("exchangeSegment", ""),
                        "signal": "BUY" if p.get("netQty", 0) >= 0 else "SELL",
                        "quantity": abs(p.get("netQty", 0)),
                        "avg_price": float(p.get("costPrice", 0)),
                    }
                    for p in rows
                    if p.get("netQty", 0) != 0
                ]
            except Exception as exc:
                log.error("dhan.positions.failed", error=str(exc))
                return []
