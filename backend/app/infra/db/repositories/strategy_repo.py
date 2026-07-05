"""MongoDB repository for user strategies."""
from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
from uuid import UUID

import motor.motor_asyncio
import structlog

from app.core.config import settings
from app.domain.models.strategy import Strategy, StrategyCondition

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


def _col() -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
    return _db()["strategies"]


def _from_doc(doc: dict) -> Strategy:
    return Strategy(
        id=UUID(doc["id"]),
        name=doc["name"],
        user_id=doc["user_id"],
        action=doc["action"],
        description=doc.get("description", ""),
        is_active=doc.get("is_active", True),
        created_at=doc.get("created_at", datetime.now(UTC)),
        conditions=[
            StrategyCondition(
                indicator=c["indicator"],
                operator=c["operator"],
                value=float(c["value"]),
            )
            for c in doc.get("conditions", [])
        ],
    )


class StrategyRepository:
    async def save(self, strategy: Strategy) -> Strategy:
        doc = asdict(strategy)
        doc["id"] = str(strategy.id)
        doc["created_at"] = strategy.created_at.isoformat()
        await _col().update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)
        return strategy

    async def get(self, strategy_id: str) -> Strategy | None:
        doc = await _col().find_one({"id": strategy_id}, {"_id": 0})
        return _from_doc(doc) if doc else None

    async def list_by_user(self, user_id: str) -> list[Strategy]:
        cursor = _col().find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1)
        docs = await cursor.to_list(length=200)
        return [_from_doc(d) for d in docs]

    async def delete(self, strategy_id: str, user_id: str) -> bool:
        result = await _col().delete_one({"id": strategy_id, "user_id": user_id})
        return result.deleted_count > 0

    async def set_active(self, strategy_id: str, user_id: str, active: bool) -> None:
        await _col().update_one(
            {"id": strategy_id, "user_id": user_id},
            {"$set": {"is_active": active}},
        )
