"""MongoDB repository for Kotegawa Early Reversal scan records.

Collection: kotegawa_early_scans (in mts_journal DB) — one document per
scan_date, same as KotegawaRepository, but picks ACCUMULATE across a day's
repeated intraday scans (see append_picks) instead of being overwritten on
each run. Early Reversal resolves same-day (see kotegawa_early_service.py's
check_kotegawa_early_outcomes/expire_kotegawa_early_picks), so a pick from
an earlier-in-the-day run has to survive in the DB to actually be checked
against its own target/stop -- unlike Golden Stock's overwrite-per-run
scans, which get away with discarding earlier picks because they resolve
against subsequent-day closes regardless of which run produced them.

Otherwise mirrors KotegawaRepository's shape exactly so it plugs into
strategy_lab_live_backtest_service.py's shared live-backtest engine without
any special-casing.
"""

import dataclasses
from datetime import datetime

import motor.motor_asyncio
import structlog
from bson import ObjectId

from app.core.config import settings
from app.infra.scanner.kotegawa_scanner import KotegawaCandidate

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class KotegawaEarlyRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["kotegawa_early_scans"]

    async def append_picks(
        self,
        scan_date: str,
        scan_time: str,
        universe_scanned: int,
        passed_filter: int,
        new_picks: list[KotegawaCandidate],
    ) -> None:
        """Appends this run's newly-detected picks to today's existing
        document instead of overwriting it (see this module's own
        docstring for why). Caller (kotegawa_early_service.py) is
        responsible for excluding symbols that already have an unresolved
        pick today before calling this, so the array never gets duplicate/
        conflicting entries for the same stock. A no-op if this run found
        nothing new -- avoids upserting an empty-picks doc for every 15-min
        run on a quiet day."""
        if not new_picks:
            return
        now = datetime.utcnow()
        pick_docs = [dataclasses.asdict(p) for p in new_picks]
        for pd in pick_docs:
            pd.setdefault("outcome", None)
            pd.setdefault("actual_close", None)
            pd.setdefault("actual_pct", None)
            pd.setdefault("resolved_at", None)

        await self._col.update_one(
            {"scan_date": scan_date},
            {
                "$push": {"picks": {"$each": pick_docs}},
                "$set": {
                    "universe_scanned": universe_scanned,
                    "passed_filter": passed_filter,
                    "scan_time": scan_time,
                    "updated_at": now,
                },
                "$setOnInsert": {"scan_date": scan_date, "created_at": now},
            },
            upsert=True,
        )
        # Pipeline update (Mongo 4.2+) to keep pick_count in sync with the
        # array size -- get_history()'s $slice projection can't derive the
        # true count from a truncated array, so this has to be stored.
        await self._col.update_one(
            {"scan_date": scan_date}, [{"$set": {"pick_count": {"$size": "$picks"}}}]
        )

    async def get_latest_scan(self) -> dict | None:
        doc = await self._col.find_one({}, sort=[("created_at", -1)])
        if doc is None:
            return None
        return _clean(doc)

    async def get_history(self, limit: int = 30) -> list[dict]:
        cursor = (
            self._col.find(
                {},
                projection={
                    "scan_date": 1,
                    "scan_time": 1,
                    "universe_scanned": 1,
                    "passed_filter": 1,
                    "created_at": 1,
                    "pick_count": 1,
                    "picks": {"$slice": 1},
                },
            )
            .sort("created_at", -1)
            .limit(limit)
        )

        results = []
        async for doc in cursor:
            picks = doc.get("picks", [])
            top = picks[0] if picks else {}
            results.append(
                {
                    "id": str(doc["_id"]),
                    "scan_date": doc.get("scan_date", ""),
                    "scan_time": doc.get("scan_time", ""),
                    "universe_scanned": doc.get("universe_scanned", 0),
                    "passed_filter": doc.get("passed_filter", 0),
                    "pick_count": doc.get("pick_count", len(picks)),
                    "top_symbol": top.get("symbol", ""),
                    "top_score": top.get("confidence_score", 0),
                    "top_entry_price": top.get("entry_price"),
                    "created_at": doc.get("created_at", ""),
                }
            )
        return results

    async def get_scan_by_date(self, date_str: str) -> dict | None:
        doc = await self._col.find_one({"scan_date": date_str})
        if doc is None:
            return None
        return _clean(doc)

    async def list_scans_with_unresolved_picks(self, since_date: str) -> list[dict]:
        """Every scan doc from `since_date` onward that still has at least
        one unresolved pick (outcome is null). Mirrors KotegawaRepository's
        method of the same name -- called with today's date by
        check_kotegawa_early_outcomes()/expire_kotegawa_early_picks(),
        since this strategy resolves same-day."""
        cursor = self._col.find(
            {"scan_date": {"$gte": since_date}, "picks.outcome": None}
        )
        return [_clean(doc) async for doc in cursor]

    async def update_pick_outcome(
        self,
        scan_id: str,
        symbol: str,
        actual_close: float,
        actual_pct: float,
        outcome: str,
    ) -> None:
        await self._col.update_one(
            {"_id": ObjectId(scan_id), "picks.symbol": symbol},
            {
                "$set": {
                    "picks.$.outcome": outcome,
                    "picks.$.actual_close": actual_close,
                    "picks.$.actual_pct": actual_pct,
                    "picks.$.resolved_at": datetime.utcnow().isoformat(),
                }
            },
        )

    async def list_picks_by_outcome(
        self, outcomes: list[str] | None, since_date: str | None = None, limit: int = 200
    ) -> list[dict]:
        """Flat list of picks whose outcome is one of `outcomes` (WIN/LOSS/
        NEUTRAL -- see kotegawa_early_service.py's resolver, not Reversal's
        target_hit/sl_hit/expired), most recent scan first -- or, when
        `outcomes` is None, picks that haven't resolved yet. Shape must
        stay identical to KotegawaRepository's method of the same name
        since strategy_lab_live_backtest_service.py's _fetch_picks()
        consumes it directly."""
        date_match: dict = {} if since_date is None else {"scan_date": {"$gte": since_date}}
        outcome_match = (
            {"picks.outcome": None} if outcomes is None else {"picks.outcome": {"$in": outcomes}}
        )
        cursor = self._col.aggregate(
            [
                {"$match": date_match},
                {"$unwind": "$picks"},
                {"$match": outcome_match},
                {"$sort": {"scan_date": -1}},
                {"$limit": limit},
                {
                    "$project": {
                        "_id": 0,
                        "symbol": "$picks.symbol",
                        "name": "$picks.name",
                        "outcome": "$picks.outcome",
                        "entry_price": "$picks.entry_price",
                        "exit_price": "$picks.actual_close",
                        "return_pct": "$picks.actual_pct",
                        "scan_date": "$scan_date",
                        "resolved_at": "$picks.resolved_at",
                        "confidence_score": "$picks.confidence_score",
                        "rsi": "$picks.rsi",
                        "volume_ratio": "$picks.volume_ratio",
                    }
                },
            ]
        )
        return [doc async for doc in cursor]

    async def get_performance_stats(self, since_date: str | None = None) -> dict:
        """Aggregate accuracy stats across all resolved picks. Mirrors
        KotegawaRepository's method of the same name/shape, but counts
        WIN/LOSS/NEUTRAL (same-day resolution) instead of target_hit/
        sl_hit/expired."""
        date_match: dict = {} if since_date is None else {"scan_date": {"$gte": since_date}}
        total_picks = await self._col.aggregate(
            [
                {"$match": date_match},
                {"$unwind": "$picks"},
                {"$count": "n"},
            ]
        ).to_list(length=1)
        total_picks_ever = total_picks[0]["n"] if total_picks else 0

        pipeline = [
            {"$match": date_match},
            {"$unwind": "$picks"},
            {"$match": {"picks.outcome": {"$ne": None}}},
            {
                "$group": {
                    "_id": None,
                    "total": {"$sum": 1},
                    "wins": {"$sum": {"$cond": [{"$eq": ["$picks.outcome", "WIN"]}, 1, 0]}},
                    "losses": {"$sum": {"$cond": [{"$eq": ["$picks.outcome", "LOSS"]}, 1, 0]}},
                    "neutral": {"$sum": {"$cond": [{"$eq": ["$picks.outcome", "NEUTRAL"]}, 1, 0]}},
                    "avg_return": {"$avg": "$picks.actual_pct"},
                }
            },
        ]
        results = [doc async for doc in self._col.aggregate(pipeline)]
        if not results:
            return {
                "total_calls": total_picks_ever,
                "resolved": 0,
                "wins": 0,
                "losses": 0,
                "neutral": 0,
                "hit_rate_pct": None,
                "avg_return_pct": None,
            }
        r = results[0]
        wins, losses = r.get("wins", 0), r.get("losses", 0)
        return {
            "total_calls": total_picks_ever,
            "resolved": r.get("total", 0),
            "wins": wins,
            "losses": losses,
            "neutral": r.get("neutral", 0),
            "hit_rate_pct": (
                round(wins / (wins + losses) * 100, 1) if (wins + losses) > 0 else None
            ),
            "avg_return_pct": round(r.get("avg_return") or 0.0, 2),
        }


def _clean(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    if "created_at" in doc and isinstance(doc["created_at"], datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc
