"""MongoDB repository for stored daily portfolio performance snapshots.

Collection: portfolio_summary_snapshots -- one document per (user_id,
portfolio_id, date). Populated by the daily EOD scheduler job so a specific
past day's summary can be looked up later instead of recomputed from a
rolling yfinance window that only knows "now".
"""

import motor.motor_asyncio

from app.core.config import settings

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class PortfolioSummaryRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["portfolio_summary_snapshots"]

    async def save_snapshot(
        self, user_id: str, portfolio_id: str, date_str: str, data: dict
    ) -> None:
        doc = {**data, "user_id": user_id, "portfolio_id": portfolio_id, "date": date_str}
        await self._col.update_one(
            {"user_id": user_id, "portfolio_id": portfolio_id, "date": date_str},
            {"$set": doc},
            upsert=True,
        )

    async def get_snapshot(self, user_id: str, portfolio_id: str, date_str: str) -> dict | None:
        return await self._col.find_one(
            {"user_id": user_id, "portfolio_id": portfolio_id, "date": date_str}, {"_id": 0}
        )
