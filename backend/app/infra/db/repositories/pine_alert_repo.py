"""MongoDB repository for Pine Alerts -- raw TradingView alertcondition()
firings received via the /mcx/pine-alerts/webhook receiver (see
api/v1/pine_alerts.py). One document per fired alert, append-only.

Deliberately separate from mcx_trade_signals (McxSignalRepository): those
are this app's own Python re-implementation of the same scoring logic,
computed and logged independently of TradingView. Pine Alerts are the
ground-truth record of what the actual Pine Script running on TradingView's
own infrastructure fired, which is why the user asked for them by name --
same "two independent engines" reasoning that motivated verifying email
delivery with a real TradingView-side alert in the first place.
"""

from __future__ import annotations

from datetime import UTC, datetime

import motor.motor_asyncio

from app.core.config import settings

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class PineAlertRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["pine_alerts"]

    async def create(
        self,
        contract: str,
        strategy: str,
        signal_type: str,
        price: float | None,
        message: str,
        tv_time: str | None,
        raw: dict,
    ) -> None:
        await self._col.insert_one(
            {
                "contract": contract.upper(),
                "strategy": strategy,
                "signal_type": signal_type.upper(),
                "price": price,
                "message": message,
                "tv_time": tv_time,
                "raw": raw,
                "received_at": datetime.now(UTC).replace(tzinfo=None),
            }
        )

    async def list_recent(self, contract: str, limit: int = 50) -> list[dict]:
        cursor = (
            self._col.find({"contract": contract.upper()}, {"_id": 0})
            .sort("received_at", -1)
            .limit(limit)
        )
        return [d async for d in cursor]

    async def list_recent_all(self, limit: int = 200) -> list[dict]:
        cursor = self._col.find({}, {"_id": 0}).sort("received_at", -1).limit(limit)
        return [d async for d in cursor]
