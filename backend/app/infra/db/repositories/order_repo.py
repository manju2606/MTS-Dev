"""MongoDB-backed live order store — persists orders across pod restarts."""

from datetime import datetime
from uuid import UUID

import motor.motor_asyncio  # type: ignore[import-untyped]
import structlog

from app.domain.models.order import LiveOrder

log = structlog.get_logger()

_client = None


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        from app.core.config import settings
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client["mts_journal"]


class OrderRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["live_orders"]

    async def save(self, order: LiveOrder) -> None:
        doc = {
            "_id": str(order.id),
            "user_id": str(order.user_id),
            "symbol": order.symbol,
            "exchange": order.exchange,
            "signal": order.signal,
            "quantity": order.quantity,
            "order_type": order.order_type,
            "broker": order.broker,
            "price": order.price,
            "broker_order_id": order.broker_order_id,
            "status": order.status,
            "fill_price": order.fill_price,
            "fill_time": order.fill_time,
            "created_at": order.created_at,
        }
        try:
            await self._col.replace_one({"_id": str(order.id)}, doc, upsert=True)
        except Exception as exc:
            log.error("order_repo.save.failed", order_id=str(order.id), error=str(exc))

    async def list_by_user(self, user_id: str, limit: int = 200) -> list[LiveOrder]:
        try:
            cursor = self._col.find({"user_id": user_id}).sort("created_at", -1).limit(limit)
            orders = []
            async for doc in cursor:
                orders.append(_doc_to_order(doc))
            return orders
        except Exception as exc:
            log.error("order_repo.list.failed", user_id=user_id, error=str(exc))
            return []

    async def update_status(self, order_id: str, status: str) -> None:
        try:
            await self._col.update_one({"_id": order_id}, {"$set": {"status": status}})
        except Exception as exc:
            log.error("order_repo.update.failed", order_id=order_id, error=str(exc))

    async def get(self, order_id: str) -> LiveOrder | None:
        try:
            doc = await self._col.find_one({"_id": order_id})
            return _doc_to_order(doc) if doc else None
        except Exception:
            return None


def _doc_to_order(doc: dict) -> LiveOrder:
    return LiveOrder(
        id=UUID(doc["_id"]),
        user_id=UUID(doc["user_id"]),
        symbol=doc["symbol"],
        exchange=doc["exchange"],
        signal=doc["signal"],
        quantity=doc["quantity"],
        order_type=doc["order_type"],
        broker=doc["broker"],
        price=doc.get("price"),
        broker_order_id=doc.get("broker_order_id"),
        status=doc.get("status", "pending"),
        fill_price=doc.get("fill_price"),
        fill_time=doc.get("fill_time"),
        created_at=doc.get("created_at", datetime.utcnow()),
    )
