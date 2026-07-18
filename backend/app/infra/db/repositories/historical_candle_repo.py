"""MongoDB repository for downloaded historical OHLCV candles (equities,
indices, F&O, MCX -- anything resolvable via Zerodha's instrument master).

Collection: historical_candles -- one document per closed candle, keyed on
(symbol, exchange, interval, time) so re-downloading an overlapping date
range upserts instead of duplicating. Mirrors the mcx_candles pattern in
mcx_candle_repo.py.
"""

from datetime import datetime

import motor.motor_asyncio
import pymongo

from app.core.config import settings
from app.domain.models.historical_candle import HistoricalCandle

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class HistoricalCandleRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["historical_candles"]

    async def ensure_indexes(self) -> None:
        await self._col.create_index(
            [("symbol", 1), ("exchange", 1), ("interval", 1), ("time", 1)], unique=True
        )

    async def upsert_many(self, candles: list[HistoricalCandle]) -> int:
        """Upserts each candle keyed on (symbol, exchange, interval, time).
        Returns the number of new candles written -- existing ones are
        matched and left untouched since a closed candle's OHLCV never
        changes."""
        if not candles:
            return 0

        now = datetime.utcnow()
        ops = [
            pymongo.UpdateOne(
                {
                    "symbol": c.symbol.upper(),
                    "exchange": c.exchange.upper(),
                    "interval": c.interval,
                    "time": c.time,
                },
                {
                    "$setOnInsert": {
                        "symbol": c.symbol.upper(),
                        "exchange": c.exchange.upper(),
                        "interval": c.interval,
                        "time": c.time,
                        "open": c.open,
                        "high": c.high,
                        "low": c.low,
                        "close": c.close,
                        "volume": c.volume,
                        "open_interest": c.open_interest,
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
        self, symbol: str, exchange: str, interval: str, start: datetime, end: datetime
    ) -> list[HistoricalCandle]:
        cursor = self._col.find(
            {
                "symbol": symbol.upper(),
                "exchange": exchange.upper(),
                "interval": interval,
                "time": {"$gte": start, "$lte": end},
            },
            {"_id": 0},
        ).sort("time", 1)
        return [_from_doc(doc) async for doc in cursor]

    async def list_downloaded_symbols(self) -> list[dict]:
        """Distinct (symbol, exchange, interval) combos already downloaded,
        for a "what do I already have" browse view."""
        pipeline = [
            {
                "$group": {
                    "_id": {"symbol": "$symbol", "exchange": "$exchange", "interval": "$interval"},
                    "candles": {"$sum": 1},
                    "from_time": {"$min": "$time"},
                    "to_time": {"$max": "$time"},
                }
            },
            {"$sort": {"_id.symbol": 1}},
        ]
        return [
            {
                "symbol": doc["_id"]["symbol"],
                "exchange": doc["_id"]["exchange"],
                "interval": doc["_id"]["interval"],
                "candles": doc["candles"],
                "from_time": doc["from_time"],
                "to_time": doc["to_time"],
            }
            async for doc in self._col.aggregate(pipeline)
        ]

    async def delete_series(self, symbol: str, exchange: str, interval: str) -> int:
        result = await self._col.delete_many(
            {"symbol": symbol.upper(), "exchange": exchange.upper(), "interval": interval}
        )
        return int(result.deleted_count)


def _from_doc(doc: dict) -> HistoricalCandle:
    return HistoricalCandle(
        symbol=doc["symbol"],
        exchange=doc["exchange"],
        interval=doc["interval"],
        time=doc["time"],
        open=doc["open"],
        high=doc["high"],
        low=doc["low"],
        close=doc["close"],
        volume=doc["volume"],
        open_interest=doc.get("open_interest"),
        saved_at=doc.get("saved_at"),
    )
