"""MongoDB repository for forecast results and accuracy tracking."""
from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime

import motor.motor_asyncio
import structlog

from app.core.config import settings
from app.domain.models.forecast import ForecastResult

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class ForecastRepository:
    @property
    def _results(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["forecast_results"]

    @property
    def _accuracy(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["forecast_accuracy"]

    async def save_result(self, result: ForecastResult) -> None:
        doc = asdict(result)
        doc["id"] = str(doc["id"])
        doc["generated_at"] = result.generated_at.isoformat()
        await self._results.update_one(
            {"symbol": result.symbol},
            {"$set": doc},
            upsert=True,
        )
        log.info("forecast.saved", symbol=result.symbol)

    async def get_by_symbol(self, symbol: str) -> dict | None:
        doc = await self._results.find_one({"symbol": symbol}, {"_id": 0})
        return doc

    async def list_history(
        self,
        symbol: str,
        horizon: str | None = None,
        limit: int = 30,
    ) -> list[dict]:
        query: dict = {"symbol": symbol}
        if horizon:
            query["horizon"] = horizon
        cursor = (
            self._accuracy.find(query, {"_id": 0})
            .sort("generated_at", -1)
            .limit(limit)
        )
        return await cursor.to_list(length=limit)

    async def save_accuracy_records(self, records: list[dict]) -> None:
        if not records:
            return
        await self._accuracy.insert_many(records)

    async def resolve_predictions_for_date(self, target_date: str) -> int:
        """Fill actual_price + error_pct for all unresolved records whose target_date has passed."""
        import yfinance as yf

        projection = {
            "_id": 1, "symbol": 1, "predicted_price": 1,
            "predicted_change_pct": 1, "direction": 1,
        }
        unresolved = await self._accuracy.find(
            {"target_date": {"$lte": target_date}, "actual_price": None},
            projection,
        ).to_list(length=500)

        if not unresolved:
            return 0

        symbols = list({r["symbol"] for r in unresolved})
        prices: dict[str, float] = {}
        for sym in symbols:
            try:
                hist = yf.Ticker(sym).history(period="2d")
                if not hist.empty:
                    prices[sym] = float(hist["Close"].iloc[-1])
            except Exception:
                pass

        updated = 0
        now = datetime.now(UTC).replace(tzinfo=None).isoformat()
        for rec in unresolved:
            sym = rec["symbol"]
            actual = prices.get(sym)
            if actual is None:
                continue
            predicted = float(rec["predicted_price"])
            error_pct = abs(predicted - actual) / (actual + 1e-9) * 100
            predicted_dir = rec.get("direction", "FLAT")
            if actual > predicted * 1.005:
                actual_dir = "UP"
            elif actual < predicted * 0.995:
                actual_dir = "DOWN"
            else:
                actual_dir = "FLAT"
            await self._accuracy.update_one(
                {"_id": rec["_id"]},
                {"$set": {
                    "actual_price": round(actual, 2),
                    "error_pct": round(error_pct, 2),
                    "direction_correct": predicted_dir == actual_dir,
                    "resolved_at": now,
                }},
            )
            updated += 1

        log.info("forecast.accuracy.resolved", count=updated, date=target_date)
        return updated
