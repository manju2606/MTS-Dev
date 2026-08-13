"""MongoDB repository for MCX short-horizon price predictions and their
resolved accuracy (see app/services/mcx_prediction_service.py). One document
per (user_id, contract, period, predicted_time) -- saved when generated, then
resolved (hit/miss + actual close) once real time reaches that candle and a
matching actual close becomes available.
"""

from __future__ import annotations

import bisect
import contextlib
from datetime import datetime, timedelta

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

    async def ensure_indexes(self) -> None:
        """mcx_predictions had *no* index beyond the default _id -- every
        query here (get_soonest_pending's sort, resolve_pending's find/
        update_many, get_accuracy_stats) was a full collection scan. Seen in
        prod: with the collection grown into the hundreds of thousands of
        documents (predictions are never deleted, see get_by_date_range),
        that alone was enough to pin MongoDB's CPU and starve the whole
        droplet of memory. A basic count query went from 20s+ timeout to
        under a second once this index existed.

        Not unique: save_predictions()'s upsert is meant to enforce one doc
        per (user_id, contract, period, predicted_time), but production
        already has pre-existing duplicates from before this index existed
        -- a unique index here throws IndexKeyLength/DuplicateKey and fails
        to build at all, taking every prediction request down with it (this
        broke prod once already). create_index is a no-op once the index
        exists, so failures are swallowed rather than surfaced on every
        single call -- this is a perf optimization, not a correctness
        requirement, and a request should still work without it."""
        with contextlib.suppress(Exception):
            await self._col.create_index(
                [
                    ("user_id", 1),
                    ("contract", 1),
                    ("period", 1),
                    ("resolved", 1),
                    ("predicted_time", 1),
                ]
            )

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

    # How long a still-unresolved prediction is given to find a matching
    # candle before we give up on it. get_history()'s Kite interval map
    # (mcx_service._HISTORY_PERIOD_MAP) only looks back 5-30 days for the
    # short intraday periods (vs. 90 for 1h), so a prediction that's missed
    # its candle window this long is *never* going to resolve -- every
    # future resolve_pending() call fetches the same trailing window and
    # will never again reach that far back. Left alone, that one stuck doc
    # sorts first in every get_soonest_pending()/"soonest pending" query
    # forever, permanently hiding all fresher predictions behind it.
    _EXPIRE_AFTER = timedelta(days=1)

    async def resolve_pending(
        self,
        user_id: str,
        contract: str,
        period: str,
        candles: list[dict],
        tolerance_seconds: int = 0,
    ) -> None:
        """Match any not-yet-resolved predictions against real candles that
        have since arrived at their predicted_time, and record hit/miss.
        Anything left unresolved past _EXPIRE_AFTER is marked expired (not
        counted as a hit or miss -- see get_accuracy_stats) purely so it
        stops blocking fresher predictions from being read as "pending".

        tolerance_seconds lets a prediction match the nearest candle within
        that window instead of requiring an exact predicted_time hit --
        Kite's minute/15minute candle series can simply omit a quiet minute
        with no trades, which otherwise permanently strands that one bucket
        (seen in prod: 1m/15m/30m stuck for hours behind a single missing
        candle). Pass the caller's own bucket width so a bucket only ever
        matches a candle that's genuinely "close enough", never reaching
        into a neighboring bucket's candle."""
        base_query = {
            "user_id": user_id,
            "contract": contract.upper(),
            "period": period,
            "resolved": False,
        }
        expire_cutoff = int((datetime.utcnow() - self._EXPIRE_AFTER).timestamp())

        # Bulk-expire anything already past _EXPIRE_AFTER in one round trip
        # *before* the per-document loop below -- a backlog that built up
        # while this was still exact-match-only (seen in prod: thousands of
        # docs stuck behind an overnight market-closed gap) would otherwise
        # mean thousands of individual update_one calls every single time
        # this runs, on every 5-min scheduler tick, for every contract.
        await self._col.update_many(
            {**base_query, "predicted_time": {"$lt": expire_cutoff}},
            {"$set": {"resolved": True, "expired": True, "resolved_at": datetime.utcnow()}},
        )

        by_time = {c["time"]: c for c in candles}
        sorted_times = sorted(by_time) if tolerance_seconds else []
        cursor = self._col.find(base_query)
        async for doc in cursor:
            actual = by_time.get(doc["predicted_time"])
            if actual is None and tolerance_seconds and sorted_times:
                actual = self._nearest_candle(
                    by_time, sorted_times, doc["predicted_time"], tolerance_seconds
                )
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

    @staticmethod
    def _nearest_candle(
        by_time: dict[int, dict], sorted_times: list[int], target: int, tolerance_seconds: int
    ) -> dict | None:
        """Closest candle to `target` among `sorted_times`, or None if the
        nearest one is further than tolerance_seconds away."""
        i = bisect.bisect_left(sorted_times, target)
        candidates = sorted_times[max(0, i - 1) : i + 1]
        if not candidates:
            return None
        closest = min(candidates, key=lambda t: abs(t - target))
        return by_time[closest] if abs(closest - target) <= tolerance_seconds else None

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
        self,
        user_id: str,
        contract: str,
        period: str,
        at: datetime,
        reason: str,
        from_accuracy_pct: float | None,
        deviation_pct: float | None,
    ) -> None:
        """Persist the accuracy value that triggered this recalibration
        (from_accuracy_pct) and how far it had drifted from a perfect
        prediction (deviation_pct = avg_error_pct at the moment of trigger)
        -- kept alongside last_recalibrated_at so both stay visible on every
        later call, not just the one response where recalibration fired."""
        await self._recal_col.update_one(
            {"user_id": user_id, "contract": contract.upper(), "period": period},
            {
                "$set": {
                    "last_recalibrated_at": at,
                    "reason": reason,
                    "from_accuracy_pct": from_accuracy_pct,
                    "deviation_pct": deviation_pct,
                }
            },
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

    # A still-unresolved prediction older than this is treated as if it
    # doesn't exist for "soonest pending" purposes -- e.g. a bucket
    # generated for a slot the market was closed for (seen in prod: a
    # 1-minute bucket sitting unresolved for 9.5+ hours across an overnight
    # NG trading halt) will never get a real candle to match against.
    # resolve_pending()'s _EXPIRE_AFTER (1 day) eventually marks these
    # resolved=true in the DB too, but that only runs as a side effect of
    # get_prediction() -- this filter makes the dashboard stop surfacing
    # them as "the current prediction" immediately, without waiting on that.
    _SOONEST_PENDING_MAX_AGE = timedelta(hours=1)

    async def get_soonest_pending(self, user_id: str, contract: str, period: str) -> dict | None:
        """Nearest still-unresolved predicted bucket for (contract, period) --
        a plain read of whatever the 5-min mcx_prediction_check /
        mcx_metals_prediction_check jobs already generated and saved, no live
        Kite call. Used by My Trading Dashboard (mcx_my_dashboard_service.py)
        instead of get_prediction()/get_metal_prediction(), which each do a
        live historical-candle fetch per call -- fine for one contract's
        Prediction tab, too slow against Kite's historical-data rate limit
        once you're covering many contracts on one page."""
        min_time = int((datetime.utcnow() - self._SOONEST_PENDING_MAX_AGE).timestamp())
        query = {
            "user_id": user_id,
            "contract": contract.upper(),
            "period": period,
            "resolved": False,
            "predicted_time": {"$gte": min_time},
        }
        return await self._col.find_one(query, {"_id": 0}, sort=[("predicted_time", 1)])

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
            "expired": {"$ne": True},
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
