"""MongoDB repository for saved screener configurations."""
from __future__ import annotations

from uuid import UUID

import motor.motor_asyncio

from app.core.config import settings
from app.domain.models.screener import SavedScreen, ScreenerCriterion

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db():  # type: ignore[return]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


def _col():  # type: ignore[return]
    return _get_db()["saved_screens"]


def _from_doc(doc: dict) -> SavedScreen:
    return SavedScreen(
        id=UUID(doc["id"]),
        user_id=doc["user_id"],
        name=doc["name"],
        universe=doc["universe"],
        criteria=[ScreenerCriterion(**c) for c in doc.get("criteria", [])],
        created_at=doc["created_at"],
    )


async def list_by_user(user_id: str) -> list[SavedScreen]:
    cursor = _col().find({"user_id": user_id}).sort("created_at", -1)
    return [_from_doc(d) async for d in cursor]


async def create(screen: SavedScreen) -> SavedScreen:
    await _col().insert_one({
        "id": str(screen.id),
        "user_id": screen.user_id,
        "name": screen.name,
        "universe": screen.universe,
        "criteria": [{"field": c.field, "operator": c.operator, "value": c.value}
                     for c in screen.criteria],
        "created_at": screen.created_at,
    })
    return screen


async def delete(screen_id: str, user_id: str) -> bool:
    result = await _col().delete_one({"id": screen_id, "user_id": user_id})
    return result.deleted_count > 0
