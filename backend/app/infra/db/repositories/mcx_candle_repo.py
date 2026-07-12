"""MongoDB repository for MCX OHLCV candle history.

Collection: mcx_candles -- one document per closed candle, keyed on
(contract, interval, time) so repeated collection runs upsert instead of
duplicating. This is the raw price series MCX NG/Metals prediction currently
re-fetches live from Kite on every call and discards (see
mcx_service.get_history) -- persisting it here is what a future ML model
would train against.
"""

from datetime import datetime

import motor.motor_asyncio
import pymongo

from app.core.config import settings

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class McxCandleRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_candles"]

    async def ensure_indexes(self) -> None:
        await self._col.create_index(
            [("contract", 1), ("interval", 1), ("time", 1)], unique=True
        )

    async def upsert_many(self, contract: str, interval: str, candles: list[dict]) -> int:
        """Upserts each candle keyed on (contract, interval, time). Returns
        the number of new candles written (upserted_count) -- existing ones
        are matched and left untouched, not re-written, since a closed
        candle's OHLCV never changes."""
        if not candles:
            return 0

        now = datetime.utcnow()
        ops = [
            pymongo.UpdateOne(
                {"contract": contract.upper(), "interval": interval, "time": c["time"]},
                {
                    "$setOnInsert": {
                        "contract": contract.upper(),
                        "interval": interval,
                        "time": c["time"],
                        "open": c["open"],
                        "high": c["high"],
                        "low": c["low"],
                        "close": c["close"],
                        "volume": c["volume"],
                        "saved_at": now,
                    }
                },
                upsert=True,
            )
            for c in candles
        ]
        result = await self._col.bulk_write(ops, ordered=False)
        return result.upserted_count

    async def get_range(
        self, contract: str, interval: str, start: int, end: int
    ) -> list[dict]:
        cursor = self._col.find(
            {
                "contract": contract.upper(),
                "interval": interval,
                "time": {"$gte": start, "$lte": end},
            },
            {"_id": 0},
        ).sort("time", 1)
        return [doc async for doc in cursor]

    async def count(self, contract: str, interval: str) -> int:
        return await self._col.count_documents({"contract": contract.upper(), "interval": interval})
