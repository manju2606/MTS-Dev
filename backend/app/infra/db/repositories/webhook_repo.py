"""MongoDB repository for webhook subscriptions and delivery logs."""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
from uuid import UUID

import motor.motor_asyncio
import structlog

from app.core.config import settings
from app.domain.models.webhook import WebhookSubscription

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


def _col() -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
    return _db()["webhooks"]


def _log_col() -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
    return _db()["webhook_deliveries"]


def _parse_dt(value: str | datetime | None) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def _from_doc(doc: dict) -> WebhookSubscription:
    return WebhookSubscription(
        id=UUID(doc["id"]),
        user_id=doc["user_id"],
        url=doc["url"],
        events=doc.get("events", []),
        secret=doc.get("secret", ""),
        name=doc.get("name", ""),
        is_active=doc.get("is_active", True),
        created_at=_parse_dt(doc.get("created_at")) or datetime.now(UTC),
        last_triggered_at=_parse_dt(doc.get("last_triggered_at")),
        failure_count=doc.get("failure_count", 0),
    )


class WebhookRepository:
    async def save(self, wh: WebhookSubscription) -> WebhookSubscription:
        doc = asdict(wh)
        doc["id"] = str(wh.id)
        doc["created_at"] = wh.created_at.isoformat()
        doc["last_triggered_at"] = (
            wh.last_triggered_at.isoformat() if wh.last_triggered_at else None
        )
        await _col().update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)
        return wh

    async def get(self, wh_id: str) -> WebhookSubscription | None:
        doc = await _col().find_one({"id": wh_id}, {"_id": 0})
        return _from_doc(doc) if doc else None

    async def list_by_user(self, user_id: str) -> list[WebhookSubscription]:
        cursor = _col().find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1)
        docs = await cursor.to_list(length=100)
        return [_from_doc(d) for d in docs]

    async def list_for_event(self, event: str) -> list[WebhookSubscription]:
        """All active webhooks subscribed to this event (across all users)."""
        cursor = _col().find(
            {"is_active": True, "events": event},
            {"_id": 0},
        )
        docs = await cursor.to_list(length=500)
        return [_from_doc(d) for d in docs]

    async def delete(self, wh_id: str, user_id: str) -> bool:
        result = await _col().delete_one({"id": wh_id, "user_id": user_id})
        return result.deleted_count > 0

    async def set_active(self, wh_id: str, user_id: str, active: bool) -> None:
        await _col().update_one(
            {"id": wh_id, "user_id": user_id},
            {"$set": {"is_active": active}},
        )

    async def record_delivery(
        self, wh_id: str, event: str, status_code: int | None, ok: bool, error: str = ""
    ) -> None:
        now = datetime.now(UTC)
        await _log_col().insert_one(
            {
                "webhook_id": wh_id,
                "event": event,
                "status_code": status_code,
                "ok": ok,
                "error": error,
                "delivered_at": now.isoformat(),
            }
        )
        update: dict = {"last_triggered_at": now.isoformat()}
        if not ok:
            await _col().update_one({"id": wh_id}, {"$set": update, "$inc": {"failure_count": 1}})
        else:
            update["failure_count"] = 0
            await _col().update_one({"id": wh_id}, {"$set": update})

    async def list_deliveries(self, wh_id: str, limit: int = 50) -> list[dict]:
        cursor = (
            _log_col().find({"webhook_id": wh_id}, {"_id": 0}).sort("delivered_at", -1).limit(limit)
        )
        return await cursor.to_list(length=limit)
