"""MongoDB repository for MCX trend-ladder snapshots.

Collection: mcx_trend_snapshots -- one document per (user_id, contract,
timeframe), overwritten on each check. Keeping only the latest snapshot per
key (not a history) is enough for regime-change detection: each new
computation only needs "what did we see last time" to decide STABLE /
WEAKENING / JUST_CHANGED.
"""

from datetime import datetime

import motor.motor_asyncio

from app.core.config import settings

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class McxTrendRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_trend_snapshots"]

    async def get_latest(self, user_id: str, contract: str, timeframe: str) -> dict | None:
        return await self._col.find_one(
            {"user_id": user_id, "contract": contract.upper(), "timeframe": timeframe}, {"_id": 0}
        )

    async def save_snapshot(self, user_id: str, contract: str, timeframe: str, data: dict) -> None:
        doc = {
            **data,
            "user_id": user_id,
            "contract": contract.upper(),
            "timeframe": timeframe,
            "updated_at": datetime.utcnow(),
        }
        await self._col.update_one(
            {"user_id": user_id, "contract": contract.upper(), "timeframe": timeframe},
            {"$set": doc},
            upsert=True,
        )
