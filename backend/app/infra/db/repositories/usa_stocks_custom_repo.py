"""MongoDB repository for user-added USA Stocks tickers -- layered on top
of usa_stocks_service.TRACKED_STOCKS' fixed base list so any user can
extend the tracked set from the UI (shared list, not per-user) without a
code change/redeploy. One document per ticker; deleting a document only
ever removes a *custom* addition -- the fixed base 50 aren't stored here
at all, so there's nothing to accidentally delete for those.
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


class UsaStocksCustomRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["usa_stocks_custom"]

    async def list_codes(self) -> list[str]:
        cursor = self._col.find({}, {"_id": 0, "code": 1})
        return [d["code"] async for d in cursor]

    async def add_code(self, code: str, added_by: str) -> None:
        await self._col.update_one(
            {"code": code.upper()},
            {"$set": {"code": code.upper(), "added_by": added_by, "added_at": datetime.utcnow()}},
            upsert=True,
        )

    async def remove_code(self, code: str) -> None:
        await self._col.delete_one({"code": code.upper()})
