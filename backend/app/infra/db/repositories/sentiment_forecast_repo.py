"""MongoDB repository for market-sentiment snapshots and weekly forecasts."""
from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime

import motor.motor_asyncio
import structlog

from app.core.config import settings
from app.domain.models.sentiment_forecast import WeeklySentimentForecast

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class SentimentForecastRepository:
    @property
    def _snapshots(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["sentiment_snapshots"]

    @property
    def _forecasts(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["sentiment_forecasts"]

    # ── Snapshots (actuals) ──────────────────────────────────────────────────

    async def save_snapshot(self, snapshot) -> None:  # noqa: ANN001
        doc = asdict(snapshot)
        doc["id"] = str(doc["id"])
        doc["created_at"] = snapshot.created_at.isoformat()
        await self._snapshots.update_one(
            {"date": snapshot.date}, {"$set": doc}, upsert=True
        )
        log.info("sentiment.snapshot.saved", date=snapshot.date, label=snapshot.label)

    async def get_snapshot(self, date_str: str) -> dict | None:
        return await self._snapshots.find_one({"date": date_str}, {"_id": 0})

    async def get_recent_snapshots(self, limit: int = 3) -> list[dict]:
        cursor = self._snapshots.find({}, {"_id": 0}).sort("date", -1).limit(limit)
        return await cursor.to_list(length=limit)

    # ── Weekly forecasts ─────────────────────────────────────────────────────

    async def save_forecast(self, forecast: WeeklySentimentForecast) -> None:
        doc = asdict(forecast)
        doc["id"] = str(doc["id"])
        doc["generated_at"] = forecast.generated_at.isoformat()
        await self._forecasts.update_one(
            {"week_start": forecast.week_start}, {"$set": doc}, upsert=True
        )
        log.info("sentiment.forecast.saved", week_start=forecast.week_start)

    async def get_forecast(self, week_start: str) -> dict | None:
        return await self._forecasts.find_one({"week_start": week_start}, {"_id": 0})

    async def list_forecast_history(self, limit: int = 12) -> list[dict]:
        cursor = self._forecasts.find({}, {"_id": 0}).sort("week_start", -1).limit(limit)
        return await cursor.to_list(length=limit)

    async def resolve_forecast_day(
        self,
        week_start: str,
        date_str: str,
        actual_bull_pct: float,
        actual_label: str,
    ) -> bool:
        """Fill in the actual outcome for one day inside a week's forecast doc."""
        forecast = await self.get_forecast(week_start)
        if not forecast:
            return False

        updated = False
        for day in forecast["days"]:
            if day["date"] != date_str:
                continue
            day["actual_bull_pct"] = actual_bull_pct
            day["actual_label"] = actual_label
            day["label_match"] = day["forecast_label"] == actual_label
            day["error_pct"] = round(abs(day["forecast_bull_pct"] - actual_bull_pct), 2)
            day["resolved_at"] = datetime.now(UTC).isoformat()
            updated = True
            break

        if not updated:
            return False

        await self._forecasts.update_one(
            {"week_start": week_start}, {"$set": {"days": forecast["days"]}}
        )
        log.info("sentiment.forecast.day_resolved", week_start=week_start, date=date_str)
        return True
