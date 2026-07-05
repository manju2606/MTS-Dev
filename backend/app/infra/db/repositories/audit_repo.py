"""MongoDB repository for audit events."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

import motor.motor_asyncio
import structlog

from app.core.config import settings
from app.domain.models.audit import AuditEvent

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


def _col() -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
    return _get_db()["audit_log"]


def _from_doc(doc: dict) -> AuditEvent:
    return AuditEvent(
        id=UUID(doc["id"]),
        user_id=doc["user_id"],
        action=doc["action"],
        resource=doc.get("resource", ""),
        details=doc.get("details", {}),
        ip=doc.get("ip", ""),
        created_at=doc["created_at"],
    )


async def log_event(event: AuditEvent) -> None:
    await _col().insert_one({
        "id": str(event.id),
        "user_id": event.user_id,
        "action": event.action,
        "resource": event.resource,
        "details": event.details,
        "ip": event.ip,
        "created_at": event.created_at,
    })


async def list_events(
    user_id: str | None = None,
    action: str | None = None,
    since: datetime | None = None,
    limit: int = 100,
    skip: int = 0,
) -> list[AuditEvent]:
    filt: dict = {}
    if user_id:
        filt["user_id"] = user_id
    if action:
        filt["action"] = {"$regex": action, "$options": "i"}
    if since:
        filt["created_at"] = {"$gte": since}
    cursor = _col().find(filt).sort("created_at", -1).skip(skip).limit(limit)
    return [_from_doc(d) async for d in cursor]


async def total_count(user_id: str | None = None, action: str | None = None) -> int:
    filt: dict = {}
    if user_id:
        filt["user_id"] = user_id
    if action:
        filt["action"] = {"$regex": action, "$options": "i"}
    return await _col().count_documents(filt)
