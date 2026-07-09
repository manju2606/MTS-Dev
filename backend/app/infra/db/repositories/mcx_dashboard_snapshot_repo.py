"""MongoDB repository for daily NG Dashboard snapshots (see
app/services/mcx_dashboard_snapshot_service.py) -- one document per
(user_id, contract, date), overwritten if a snapshot for that day is taken
more than once. Powers the Day/Week/Month history tables on the Dashboard
tab (weekly/monthly are aggregated client-side from these daily rows).
"""

from __future__ import annotations

from datetime import datetime

import motor.motor_asyncio

from app.core.config import settings

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class McxDashboardSnapshotRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_dashboard_snapshots"]

    async def save_snapshot(self, user_id: str, contract: str, date_str: str, data: dict) -> None:
        doc = {
            **data,
            "user_id": user_id,
            "contract": contract.upper(),
            "date": date_str,
            "saved_at": datetime.utcnow(),
        }
        await self._col.update_one(
            {"user_id": user_id, "contract": contract.upper(), "date": date_str},
            {"$set": doc},
            upsert=True,
        )

    async def get_range(
        self, user_id: str, contract: str, start_date: str, end_date: str
    ) -> list[dict]:
        query = {
            "user_id": user_id,
            "contract": contract.upper(),
            "date": {"$gte": start_date, "$lte": end_date},
        }
        cursor = self._col.find(query, {"_id": 0}).sort("date", 1)
        return [d async for d in cursor]
