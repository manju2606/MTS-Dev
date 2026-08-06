"""MongoDB repository for Golden Egg daily-pick records.

Collection: golden_egg_picks (in mts_journal DB). One document per
scan_date -- Golden Egg is a single-pick-per-day email (see
services/golden_egg_service.py), so unlike Golden Stock Intraday's
picks-array-per-day shape, this is just one pick (or none) per document.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime

import motor.motor_asyncio
import structlog

from app.core.config import settings
from app.infra.scanner.golden_stock_scanner import IntradayCandidate

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class GoldenEggRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["golden_egg_picks"]

    async def save_pick(
        self,
        scan_date: str,
        pick: IntradayCandidate | None,
        sizing: dict | None,
        target_profit: float,
        market_context: str | None,
    ) -> None:
        """Upsert the single pick (or "no pick") for `scan_date`."""
        doc = {
            "scan_date": scan_date,
            "pick": dataclasses.asdict(pick) if pick else None,
            "sizing": sizing,
            "target_profit": target_profit,
            "market_context": market_context,
            "updated_at": datetime.utcnow(),
        }
        await self._col.update_one(
            {"scan_date": scan_date},
            {"$set": doc, "$setOnInsert": {"created_at": datetime.utcnow()}},
            upsert=True,
        )

    async def get_latest(self) -> dict | None:
        doc = await self._col.find_one({}, sort=[("created_at", -1)])
        if doc is None:
            return None
        return _clean(doc)

    async def get_by_date(self, date_str: str) -> dict | None:
        doc = await self._col.find_one({"scan_date": date_str})
        if doc is None:
            return None
        return _clean(doc)

    async def get_history(self, limit: int = 30) -> list[dict]:
        cursor = self._col.find({}).sort("created_at", -1).limit(limit)
        return [_clean(doc) async for doc in cursor]


def _clean(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    if "created_at" in doc and isinstance(doc["created_at"], datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    if "updated_at" in doc and isinstance(doc["updated_at"], datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()
    return doc
