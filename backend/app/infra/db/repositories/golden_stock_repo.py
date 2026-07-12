"""MongoDB repository for Golden Stock Intraday scan records.

Collection: golden_stock_scans (in mts_journal DB)
"""

import dataclasses
from datetime import datetime

import motor.motor_asyncio
import structlog
from bson import ObjectId

from app.core.config import settings
from app.infra.scanner.golden_stock_scanner import GoldenStockScan

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class GoldenStockRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["golden_stock_scans"]

    async def save_scan(self, scan: GoldenStockScan) -> str:
        """Upsert scan into a single document per scan_date (one per day).

        Each intraday run (every 15 min) overwrites the previous run's picks
        for the same day, so the collection holds one document per trading day.
        """
        doc = dataclasses.asdict(scan)
        # Add outcome fields to each pick for later resolution
        for pick in doc.get("picks", []):
            pick.setdefault("outcome", None)
            pick.setdefault("actual_close", None)
            pick.setdefault("actual_pct", None)
            pick.setdefault("resolved_at", None)
        doc["pick_count"] = len(doc.get("picks", []))
        now = datetime.utcnow()
        result = await self._col.update_one(
            {"scan_date": scan.scan_date},
            {"$set": {**doc, "updated_at": now}, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        if result.upserted_id:
            return str(result.upserted_id)
        existing = await self._col.find_one({"scan_date": scan.scan_date}, {"_id": 1})
        return str(existing["_id"]) if existing else ""

    async def get_latest_scan(self) -> dict | None:
        """Return the most recent scan document."""
        doc = await self._col.find_one({}, sort=[("created_at", -1)])
        if doc is None:
            return None
        return _clean(doc)

    async def get_history(self, limit: int = 30) -> list[dict]:
        """Return recent scan metadata (no picks detail), most recent first."""
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
                    "created_at": doc.get("created_at", ""),
                }
            )
        return results

    async def get_scan_by_date(self, date_str: str) -> dict | None:
        """Return the full scan document for a specific date."""
        doc = await self._col.find_one({"scan_date": date_str}, sort=[("created_at", -1)])
        if doc is None:
            return None
        return _clean(doc)

    async def update_pick_outcome(
        self,
        scan_id: str,
        symbol: str,
        actual_close: float,
        actual_pct: float,
    ) -> None:
        """Set actual next-day outcome on a specific pick after market closes."""
        if actual_pct >= 5.0:
            outcome = "target_hit"
        elif actual_pct <= -2.5:
            outcome = "sl_hit"
        else:
            outcome = "expired"

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

    async def get_resolved_picks_between(self, start_date: str, end_date: str) -> list[dict]:
        """Flat list of picks *resolved* within a date range, for cross-engine
        report comparisons (see dsws_service.get_report).

        Filtered by resolved_at, not scan_date: picks are resolved the next
        trading day (see resolve_btst_outcomes), so a "today" report filtered
        by scan_date would always show zero — a pick scanned today has no
        outcome yet, and yesterday's pick (which resolved today) falls
        outside a scan_date-based window. Looks back a few extra days on the
        query since a Friday scan can resolve the following Monday.
        """
        from datetime import datetime, timedelta

        lookback = (datetime.strptime(start_date, "%Y-%m-%d") - timedelta(days=5)).strftime(
            "%Y-%m-%d"
        )
        cursor = self._col.find(
            {"scan_date": {"$gte": lookback, "$lte": end_date}},
            {
                "scan_date": 1,
                "scan_time": 1,
                "picks.symbol": 1,
                "picks.name": 1,
                "picks.outcome": 1,
                "picks.actual_pct": 1,
                "picks.resolved_at": 1,
                "picks.entry_price": 1,
                "picks.actual_close": 1,
                "picks.confidence_score": 1,
            },
        )
        entries: list[dict] = []
        async for doc in cursor:
            for pick in doc.get("picks", []):
                resolved_at = pick.get("resolved_at")
                if pick.get("outcome") is None or not resolved_at:
                    continue
                resolved_date = resolved_at[:10]
                if not (start_date <= resolved_date <= end_date):
                    continue
                entries.append(
                    {
                        "symbol": pick["symbol"],
                        "name": pick.get("name", pick["symbol"]),
                        "scan_date": resolved_date,
                        "pct_change": pick["actual_pct"],
                        "selected_at": doc.get("scan_time", doc["scan_date"]),
                        "entry_price": pick.get("entry_price"),
                        "current_price": pick.get("actual_close"),
                        "forecast": "UP",  # Golden Stock is a long-only breakout scanner
                        "ai_score": pick.get("confidence_score", 0),
                    }
                )
        return entries

    async def get_performance_stats(self) -> dict:
        """Aggregate accuracy stats across all resolved picks."""
        pipeline = [
            {"$unwind": "$picks"},
            {"$match": {"picks.outcome": {"$ne": None}}},
            {
                "$group": {
                    "_id": None,
                    "total": {"$sum": 1},
                    "target_hits": {
                        "$sum": {"$cond": [{"$eq": ["$picks.outcome", "target_hit"]}, 1, 0]}
                    },
                    "sl_hits": {"$sum": {"$cond": [{"$eq": ["$picks.outcome", "sl_hit"]}, 1, 0]}},
                    "expired": {"$sum": {"$cond": [{"$eq": ["$picks.outcome", "expired"]}, 1, 0]}},
                    "avg_return": {"$avg": "$picks.actual_pct"},
                }
            },
        ]
        results = []
        async for doc in self._col.aggregate(pipeline):
            results.append(doc)

        if not results:
            return {
                "total_picks": 0,
                "target_hits": 0,
                "sl_hits": 0,
                "expired": 0,
                "hit_rate_pct": 0.0,
                "avg_return_pct": 0.0,
            }

        r = results[0]
        total = r.get("total", 0)
        target_hits = r.get("target_hits", 0)
        return {
            "total_picks": total,
            "target_hits": target_hits,
            "sl_hits": r.get("sl_hits", 0),
            "expired": r.get("expired", 0),
            "hit_rate_pct": round(target_hits / total * 100, 1) if total > 0 else 0.0,
            "avg_return_pct": round(r.get("avg_return", 0.0) or 0.0, 2),
        }


def _clean(doc: dict) -> dict:
    """Convert MongoDB doc to JSON-serialisable dict."""
    doc["id"] = str(doc.pop("_id"))
    if "created_at" in doc and isinstance(doc["created_at"], datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc
