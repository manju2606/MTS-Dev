"""MongoDB repository for MCX trend-change email history.

Collection: mcx_trend_change_history -- one document per email actually sent
for a trend regime change (see mcx_trend_service._send_trend_alert), so users
can review what triggered past alerts. Unlike mcx_trend_repo.py (which only
ever keeps the latest snapshot, for regime-change detection), this is an
append-only log -- entries are never overwritten.
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


class McxTrendHistoryRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_trend_change_history"]

    async def add_entry(
        self,
        user_id: str,
        contract: str,
        tradingsymbol: str,
        changes: list[dict],
        subject: str,
        html: str,
    ) -> None:
        await self._col.insert_one(
            {
                "user_id": user_id,
                "contract": contract.upper(),
                "tradingsymbol": tradingsymbol,
                "changes": changes,
                "subject": subject,
                "html": html,
                "sent_at": datetime.utcnow(),
            }
        )

    async def get_recent(self, user_id: str, contract: str, limit: int = 50) -> list[dict]:
        """Most recent sent-email entries first -- `html` is excluded (kept
        for audit at insert time, but too heavy for a list view; the
        `changes` + `subject` summary is enough to show what fired)."""
        cursor = (
            self._col.find(
                {"user_id": user_id, "contract": contract.upper()},
                {"_id": 0, "html": 0},
            )
            .sort("sent_at", -1)
            .limit(limit)
        )
        return [d async for d in cursor]
