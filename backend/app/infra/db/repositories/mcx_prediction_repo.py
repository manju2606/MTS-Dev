"""MongoDB repository for MCX short-horizon price predictions and their
resolved accuracy (see app/services/mcx_prediction_service.py). One document
per (user_id, contract, period, predicted_time) -- saved when generated, then
resolved (hit/miss + actual close) once real time reaches that candle and a
matching actual close becomes available.
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


class McxPredictionRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_predictions"]

    @property
    def _recal_col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_recalibrations"]

    async def save_predictions(
        self, user_id: str, contract: str, period: str, predictions: list[dict]
    ) -> None:
        for p in predictions:
            await self._col.update_one(
                {
                    "user_id": user_id,
                    "contract": contract.upper(),
                    "period": period,
                    "predicted_time": p["time"],
                },
                {
                    "$setOnInsert": {
                        "user_id": user_id,
                        "contract": contract.upper(),
                        "period": period,
                        "predicted_time": p["time"],
                        "predicted_close": p["predicted_close"],
                        "upper": p["upper"],
                        "lower": p["lower"],
                        "created_at": datetime.utcnow(),
                        "resolved": False,
                    }
                },
                upsert=True,
            )

    async def resolve_pending(
        self, user_id: str, contract: str, period: str, candles: list[dict]
    ) -> None:
        """Match any not-yet-resolved predictions against real candles that
        have since arrived at their predicted_time, and record hit/miss."""
        by_time = {c["time"]: c for c in candles}
        cursor = self._col.find(
            {"user_id": user_id, "contract": contract.upper(), "period": period, "resolved": False}
        )
        async for doc in cursor:
            actual = by_time.get(doc["predicted_time"])
            if actual is None:
                continue
            actual_close = float(actual["close"])
            hit = doc["lower"] <= actual_close <= doc["upper"]
            error_pct = (
                abs(actual_close - doc["predicted_close"]) / actual_close * 100
                if actual_close
                else None
            )
            await self._col.update_one(
                {"_id": doc["_id"]},
                {
                    "$set": {
                        "resolved": True,
                        "actual_close": actual_close,
                        "hit": hit,
                        "error_pct": round(error_pct, 3) if error_pct is not None else None,
                        "resolved_at": datetime.utcnow(),
                    }
                },
            )

    async def refresh_pending(
        self, user_id: str, contract: str, period: str, predictions: list[dict]
    ) -> int:
        """Overwrite predicted_close/upper/lower for buckets that are still
        pending (not yet resolved) with freshly recomputed values -- used by
        recalibration (see mcx_prediction_service.py) so near-future buckets
        reflect the latest live price/rate instead of staying locked to
        whatever the anchor was when they were first prefilled, often hours
        earlier. Resolved (already-happened) predictions are never touched --
        the past can't be rewritten, only future forecasts improved."""
        updated = 0
        for p in predictions:
            result = await self._col.update_one(
                {
                    "user_id": user_id,
                    "contract": contract.upper(),
                    "period": period,
                    "predicted_time": p["time"],
                    "resolved": False,
                },
                {
                    "$set": {
                        "predicted_close": p["predicted_close"],
                        "upper": p["upper"],
                        "lower": p["lower"],
                        "recalibrated_at": datetime.utcnow(),
                    }
                },
            )
            updated += result.modified_count
        return updated

    async def get_recalibration_state(
        self, user_id: str, contract: str, period: str
    ) -> dict | None:
        return await self._recal_col.find_one(
            {"user_id": user_id, "contract": contract.upper(), "period": period}, {"_id": 0}
        )

    async def set_recalibration_state(
        self, user_id: str, contract: str, period: str, at: datetime, reason: str
    ) -> None:
        await self._recal_col.update_one(
            {"user_id": user_id, "contract": contract.upper(), "period": period},
            {"$set": {"last_recalibrated_at": at, "reason": reason}},
            upsert=True,
        )

    async def get_recent(
        self, user_id: str, contract: str, period: str, limit: int = 200
    ) -> list[dict]:
        """Full prediction trail (resolved and still-pending), oldest first --
        so the chart can keep showing predictions made in the past instead of
        only ever the current rolling forecast window."""
        query = {"user_id": user_id, "contract": contract.upper(), "period": period}
        cursor = self._col.find(query, {"_id": 0}).sort("predicted_time", -1).limit(limit)
        docs = [d async for d in cursor]
        docs.reverse()
        return docs

    async def get_by_date_range(
        self, user_id: str, contract: str, period: str, start_epoch: int, end_epoch: int
    ) -> list[dict]:
        """Every prediction (resolved or not) whose predicted_time falls in
        [start_epoch, end_epoch] -- the archive view for a specific calendar
        day. No separate snapshot/archival job needed: predictions are never
        deleted, so this collection already *is* the permanent record."""
        query = {
            "user_id": user_id,
            "contract": contract.upper(),
            "period": period,
            "predicted_time": {"$gte": start_epoch, "$lte": end_epoch},
        }
        cursor = self._col.find(query, {"_id": 0}).sort("predicted_time", 1)
        return [d async for d in cursor]

    async def get_accuracy_stats(
        self,
        user_id: str,
        contract: str,
        period: str,
        limit: int = 100,
        since: datetime | None = None,
    ) -> dict:
        query: dict[str, object] = {
            "user_id": user_id,
            "contract": contract.upper(),
            "period": period,
            "resolved": True,
        }
        if since is not None:
            query["resolved_at"] = {"$gte": since}
        cursor = (
            self._col.find(query, {"_id": 0, "hit": 1, "error_pct": 1})
            .sort("resolved_at", -1)
            .limit(limit)
        )
        docs = [d async for d in cursor]
        if not docs:
            return {"sample_size": 0, "hit_rate_pct": None, "avg_error_pct": None}
        hits = sum(1 for d in docs if d.get("hit"))
        errors = [d["error_pct"] for d in docs if d.get("error_pct") is not None]
        return {
            "sample_size": len(docs),
            "hit_rate_pct": round(hits / len(docs) * 100, 1),
            "avg_error_pct": round(sum(errors) / len(errors), 3) if errors else None,
        }
