"""MongoDB repository for user notifications."""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import motor.motor_asyncio
import structlog

from app.core.config import settings
from app.domain.models.notification import Notification

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


def _col() -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
    return _get_db()["notifications"]


def _from_doc(doc: dict) -> Notification:
    return Notification(
        id=UUID(doc["id"]),
        user_id=doc["user_id"],
        type=doc["type"],
        title=doc["title"],
        body=doc["body"],
        link=doc.get("link", ""),
        read=doc.get("read", False),
        created_at=doc["created_at"],
    )


async def create(n: Notification) -> Notification:
    doc = {
        "id": str(n.id),
        "user_id": n.user_id,
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "link": n.link,
        "read": n.read,
        "created_at": n.created_at,
    }
    await _col().insert_one(doc)
    return n


async def list_by_user(user_id: str, limit: int = 50) -> list[Notification]:
    cursor = _col().find({"user_id": user_id}).sort("created_at", -1).limit(limit)
    return [_from_doc(d) async for d in cursor]


async def unread_count(user_id: str) -> int:
    return await _col().count_documents({"user_id": user_id, "read": False})


async def mark_read(notification_id: str, user_id: str) -> bool:
    result = await _col().update_one(
        {"id": notification_id, "user_id": user_id},
        {"$set": {"read": True}},
    )
    return result.modified_count > 0


async def mark_all_read(user_id: str) -> int:
    result = await _col().update_many(
        {"user_id": user_id, "read": False},
        {"$set": {"read": True}},
    )
    return result.modified_count


async def clear_all(user_id: str) -> int:
    result = await _col().delete_many({"user_id": user_id})
    return result.deleted_count
