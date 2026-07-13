"""MongoDB repository for MCX end-of-day trading summaries.

Collection: mcx_day_summary_history -- one document per (user_id, contract,
date), upserted (a same-day re-run overwrites, rather than duplicating, that
day's entry). Sibling to mcx_dashboard_snapshot_repo.py (which stores the raw
daily numbers) -- this stores the derived narrative + comparison flags built
from those numbers (see mcx_day_summary_service.py).
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


class McxDaySummaryRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_day_summary_history"]

    async def save_summary(self, user_id: str, contract: str, summary: dict) -> None:
        doc = {
            **summary,
            "user_id": user_id,
            "contract": contract.upper(),
            "saved_at": datetime.utcnow(),
        }
        await self._col.update_one(
            {"user_id": user_id, "contract": contract.upper(), "date": summary["date"]},
            {"$set": doc},
            upsert=True,
        )

    async def get_latest(self, user_id: str, contract: str) -> dict | None:
        return await self._col.find_one(
            {"user_id": user_id, "contract": contract.upper()},
            {"_id": 0},
            sort=[("date", -1)],
        )

    async def get_recent(self, user_id: str, contract: str, limit: int = 30) -> list[dict]:
        """Most recent day first."""
        cursor = (
            self._col.find({"user_id": user_id, "contract": contract.upper()}, {"_id": 0})
            .sort("date", -1)
            .limit(limit)
        )
        return [d async for d in cursor]
