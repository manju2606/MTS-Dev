"""MongoDB repository for daily Global Natural Gas Symbols snapshots (see
app/services/mcx_global_symbols_snapshot_service.py) -- one document per
(user_id, key, date), where key is a stable row identifier ("NG", "NGMINI",
"henry_hub", "ttf") rather than each row's own tradingsymbol/ticker, since
MCX's tradingsymbol changes every month on contract roll. Overwritten if a
snapshot for that day is taken more than once. Powers a Day/Week/Month
history under the Global Symbols table, same pattern as the NG Dashboard's
own snapshot history (weekly/monthly aggregated client-side from these
daily rows).
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


class McxGlobalSymbolsSnapshotRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_global_symbols_snapshots"]

    async def save_snapshot(self, user_id: str, key: str, date_str: str, data: dict) -> None:
        doc = {
            **data,
            "user_id": user_id,
            "key": key,
            "date": date_str,
            "saved_at": datetime.utcnow(),
        }
        await self._col.update_one(
            {"user_id": user_id, "key": key, "date": date_str},
            {"$set": doc},
            upsert=True,
        )

    async def get_range(self, user_id: str, start_date: str, end_date: str) -> list[dict]:
        """Every row (all keys) for this user within the date range -- the
        frontend groups by `key` client-side, same as how the NG Dashboard
        history already aggregates daily rows into weekly/monthly."""
        query = {"user_id": user_id, "date": {"$gte": start_date, "$lte": end_date}}
        cursor = self._col.find(query, {"_id": 0}).sort("date", 1)
        return [d async for d in cursor]
