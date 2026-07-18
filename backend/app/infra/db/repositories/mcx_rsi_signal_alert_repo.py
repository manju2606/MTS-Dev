"""MongoDB repository for RSI Reversion live-signal email/push alert dedup
(see app/services/mcx_rsi_signal_service.py). One document per (user, contract,
version): stores the entry_time/direction of whichever position an alert has
already been sent for, so the 5-min scheduler job that recomputes the live
state (a stateless replay, see rsi_reversion_live.py) doesn't re-alert on
every poll while a position stays open -- only when a genuinely new entry
(different entry_time or direction) shows up.
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


class RsiSignalAlertRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_rsi_signal_alerts"]

    async def get(self, user_id: str, contract: str, version: str) -> dict | None:
        return await self._col.find_one(
            {"user_id": user_id, "contract": contract.upper(), "version": version}
        )

    async def mark_alerted(
        self, user_id: str, contract: str, version: str, direction: str, entry_time: datetime
    ) -> None:
        await self._col.update_one(
            {"user_id": user_id, "contract": contract.upper(), "version": version},
            {"$set": {"direction": direction, "entry_time": entry_time, "alerted_at": datetime.utcnow()}},
            upsert=True,
        )
