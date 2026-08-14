"""MongoDB repository for Golden Egg daily-pick records.

Collection: golden_egg_picks (in mts_journal DB). One document per scan
*run* (not per scan_date) -- the scheduled 09:15 IST job and any manual
admin trigger (POST /golden-egg/scan) both count as a genuine "this stock
was chosen" event and should each show up in History, including multiple
runs on the same calendar day. An earlier version upserted by scan_date,
which silently overwrote that day's earlier pick(s) on every re-run --
exactly the "AVALON this morning, then IFBIND, now only TRAVELFOOD shows"
bug this insert-only version fixes.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime

import motor.motor_asyncio
import structlog
from bson import ObjectId
from bson.errors import InvalidId

from app.core.config import settings
from app.infra.scanner.golden_stock_scanner import IntradayCandidate

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class GoldenEggRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["golden_egg_picks"]

    async def save_pick(
        self,
        scan_date: str,
        pick: IntradayCandidate | None,
        sizing: dict | None,
        target_profit: float,
        market_context: str | None,
    ) -> None:
        """Insert a new record for this scan run -- never overwrites a
        prior run's pick, even one from earlier the same day (see this
        module's docstring)."""
        pick_doc = dataclasses.asdict(pick) if pick else None
        if pick_doc is not None:
            # Outcome fields for later resolution -- see
            # golden_egg_service.check_golden_egg_outcomes/expire_golden_egg_picks.
            pick_doc.setdefault("outcome", None)
            pick_doc.setdefault("actual_close", None)
            pick_doc.setdefault("actual_pct", None)
            pick_doc.setdefault("resolved_at", None)
        doc = {
            "scan_date": scan_date,
            "pick": pick_doc,
            "sizing": sizing,
            "target_profit": target_profit,
            "market_context": market_context,
            "created_at": datetime.utcnow(),
        }
        await self._col.insert_one(doc)

    async def get_latest(self) -> dict | None:
        doc = await self._col.find_one({}, sort=[("created_at", -1)])
        if doc is None:
            return None
        return _clean(doc)

    async def get_by_date(self, date_str: str) -> dict | None:
        """Most recent run for `date_str` -- a day can now have several
        (see save_pick); this returns the latest of them."""
        doc = await self._col.find_one({"scan_date": date_str}, sort=[("created_at", -1)])
        if doc is None:
            return None
        return _clean(doc)

    async def get_history(self, limit: int = 30) -> list[dict]:
        cursor = self._col.find({}).sort("created_at", -1).limit(limit)
        return [_clean(doc) async for doc in cursor]

    async def get_by_id(self, pick_id: str) -> dict | None:
        """A specific historical run by its own id -- needed since a day can
        now hold several runs (see save_pick), so date alone no longer
        uniquely identifies one. Powers the History table's per-row link."""
        try:
            oid = ObjectId(pick_id)
        except InvalidId:
            return None
        doc = await self._col.find_one({"_id": oid})
        if doc is None:
            return None
        return _clean(doc)

    async def get_all_for_date(self, date_str: str) -> list[dict]:
        """Every run for `date_str` (oldest first) -- unlike get_by_date
        (latest only), used by watchlist_history_service.ingest_todays_picks
        so a symbol picked on an earlier same-day run isn't missed just
        because a later run picked something else."""
        cursor = self._col.find({"scan_date": date_str}).sort("created_at", 1)
        return [_clean(doc) async for doc in cursor]

    async def count_calls_since(self, since: datetime | None) -> int:
        """Number of runs that actually picked a stock (excludes the
        `pick: None` "nothing passed the filter today" runs) on or after
        `since` (all-time if None) -- for the cross-engine Performance
        dashboard's "total calls" count."""
        query: dict = {"pick": {"$ne": None}}
        if since is not None:
            query["created_at"] = {"$gte": since}
        return await self._col.count_documents(query)

    async def list_unresolved(self, since_date: str) -> list[dict]:
        """Every run from `since_date` onward with a pick that hasn't been
        resolved yet -- for check_golden_egg_outcomes/expire_golden_egg_picks
        (see golden_egg_service.py). Golden Egg is a same-session-hold pick
        (unlike Golden Stock/BTST's multi-day window), so `since_date` is
        normally just today."""
        cursor = self._col.find(
            {"scan_date": {"$gte": since_date}, "pick": {"$ne": None}, "pick.outcome": None}
        )
        return [_clean(doc) async for doc in cursor]

    async def update_pick_outcome(
        self, doc_id: str, actual_close: float, actual_pct: float, outcome: str
    ) -> None:
        """Set a run's pick to its final resolved outcome. One pick per
        document (unlike Golden Stock's per-scan pick array), so this
        updates by `_id` directly rather than a positional array match."""
        await self._col.update_one(
            {"_id": ObjectId(doc_id)},
            {
                "$set": {
                    "pick.outcome": outcome,
                    "pick.actual_close": actual_close,
                    "pick.actual_pct": actual_pct,
                    "pick.resolved_at": datetime.utcnow().isoformat(),
                }
            },
        )

    async def get_performance_stats(self, since_date: str | None) -> dict:
        """Aggregate WIN/LOSS/NEUTRAL across every pick (optionally only
        since_date onward) for the cross-engine Performance dashboard --
        same shape as StockOfDayRepository.get_performance_stats()."""
        base_query: dict = {"pick": {"$ne": None}}
        if since_date is not None:
            base_query["scan_date"] = {"$gte": since_date}
        total_calls = await self._col.count_documents(base_query)

        pipeline = [
            {"$match": {**base_query, "pick.outcome": {"$ne": None}}},
            {
                "$group": {
                    "_id": None,
                    "total": {"$sum": 1},
                    "wins": {"$sum": {"$cond": [{"$eq": ["$pick.outcome", "WIN"]}, 1, 0]}},
                    "losses": {"$sum": {"$cond": [{"$eq": ["$pick.outcome", "LOSS"]}, 1, 0]}},
                    "neutral": {"$sum": {"$cond": [{"$eq": ["$pick.outcome", "NEUTRAL"]}, 1, 0]}},
                    "avg_return": {"$avg": "$pick.actual_pct"},
                }
            },
        ]
        results = [doc async for doc in self._col.aggregate(pipeline)]

        if not results:
            return {
                "total_calls": total_calls,
                "resolved": 0,
                "wins": 0,
                "losses": 0,
                "neutral": 0,
                "win_rate_pct": None,
                "avg_return_pct": None,
            }

        r = results[0]
        wins, losses = r.get("wins", 0), r.get("losses", 0)
        return {
            "total_calls": total_calls,
            "resolved": r.get("total", 0),
            "wins": wins,
            "losses": losses,
            "neutral": r.get("neutral", 0),
            "win_rate_pct": round(wins / (wins + losses) * 100, 1) if (wins + losses) > 0 else None,
            "avg_return_pct": round(r.get("avg_return") or 0.0, 2),
        }

    async def list_picks_by_outcome(
        self, outcomes: list[str] | None, since_date: str | None = None, limit: int = 200
    ) -> list[dict]:
        """Flat list of picks whose outcome is one of `outcomes` (e.g.
        ["WIN"]/["LOSS"]), most recent scan first -- or, when `outcomes`
        is None, picks that haven't resolved yet (outcome still null) i.e.
        the "open" bucket. Same field shape as
        GoldenStockRepository.list_picks_by_outcome() so
        performance_dashboard_service._pick_row() can reuse it as-is; one
        pick per document here (not an array), so this matches directly
        rather than needing $unwind. For the Performance dashboard's
        click-through from a win/loss/open count to the actual calls."""
        date_match: dict = {} if since_date is None else {"scan_date": {"$gte": since_date}}
        outcome_match = (
            {"pick.outcome": None} if outcomes is None else {"pick.outcome": {"$in": outcomes}}
        )
        cursor = self._col.aggregate(
            [
                {"$match": {**date_match, "pick": {"$ne": None}, **outcome_match}},
                {"$sort": {"scan_date": -1}},
                {"$limit": limit},
                {
                    "$project": {
                        "_id": 0,
                        "symbol": "$pick.symbol",
                        "name": "$pick.name",
                        "outcome": "$pick.outcome",
                        "entry_price": "$pick.entry_price",
                        "exit_price": "$pick.actual_close",
                        "return_pct": "$pick.actual_pct",
                        "scan_date": "$scan_date",
                        "resolved_at": "$pick.resolved_at",
                    }
                },
            ]
        )
        return [doc async for doc in cursor]


def _clean(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    if "created_at" in doc and isinstance(doc["created_at"], datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    if "updated_at" in doc and isinstance(doc["updated_at"], datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()
    return doc
