"""MongoDB repository for Watchlist Pick History records.

Collection: watchlist_history_picks (in mts_journal DB) — one document per
pick *occurrence* (source, symbol, announced_date), each holding an
embedded array of daily price/P&L snapshots. A symbol picked again later by
the same or a different source gets its own new document, not an update to
an earlier one (see watchlist_history_service.ingest_todays_picks).
"""

import dataclasses
from datetime import datetime

import motor.motor_asyncio

from app.core.config import settings
from app.domain.models.watchlist_history import (
    WatchlistHistoryPick,
    WatchlistHistorySnapshot,
)

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class WatchlistHistoryRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["watchlist_history_picks"]

    async def ensure_indexes(self) -> None:
        await self._col.create_index(
            [("source", 1), ("symbol", 1), ("announced_date", 1)], unique=True
        )
        await self._col.create_index([("frozen", 1), ("last_snapshot_date", 1)])
        await self._col.create_index([("announced_date", -1)])

    async def create_if_new(self, pick: WatchlistHistoryPick) -> bool:
        """Idempotent insert keyed on (source, symbol, announced_date).
        Returns True if a new document was actually created."""
        now = datetime.utcnow()
        doc = dataclasses.asdict(pick)
        doc.pop("id", None)
        doc["created_at"] = now
        doc["updated_at"] = now
        result = await self._col.update_one(
            {
                "source": pick.source,
                "symbol": pick.symbol,
                "announced_date": pick.announced_date,
            },
            {"$setOnInsert": doc},
            upsert=True,
        )
        return result.upserted_id is not None

    async def list_active_for_date(self, today: str) -> list[WatchlistHistoryPick]:
        """Non-frozen picks not yet snapshotted for `today` — the daily EOD
        job's work queue. Excluding already-snapshotted picks makes the job
        safely re-runnable on a misfire retry without double-appending."""
        cursor = self._col.find({"frozen": False, "last_snapshot_date": {"$ne": today}})
        return [_from_doc(doc) async for doc in cursor]

    async def append_snapshot(
        self,
        doc_id: str,
        snapshot: WatchlistHistorySnapshot | None,
        *,
        trading_day_count: int,
        last_price: float | None,
        last_pnl_pct: float | None,
        last_snapshot_date: str | None,
        frozen: bool,
        frozen_at: str | None = None,
        freeze_reason: str | None = None,
    ) -> None:
        from bson import ObjectId

        update: dict = {
            "$set": {
                "trading_day_count": trading_day_count,
                "last_price": last_price,
                "last_pnl_pct": last_pnl_pct,
                "last_snapshot_date": last_snapshot_date,
                "frozen": frozen,
                "frozen_at": frozen_at,
                "freeze_reason": freeze_reason,
                "updated_at": datetime.utcnow(),
            }
        }
        if snapshot is not None:
            update["$push"] = {"snapshots": dataclasses.asdict(snapshot)}
        await self._col.update_one({"_id": ObjectId(doc_id)}, update)

    async def list_picks(
        self,
        source: str | None = None,
        active: bool | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        limit: int = 200,
    ) -> list[dict]:
        query: dict = {}
        if source:
            query["source"] = source.upper()
        if active is not None:
            query["frozen"] = not active
        if start_date or end_date:
            date_filter: dict = {}
            if start_date:
                date_filter["$gte"] = start_date
            if end_date:
                date_filter["$lte"] = end_date
            query["announced_date"] = date_filter

        cursor = self._col.find(query).sort("announced_date", -1).limit(limit)
        return [_clean(doc) async for doc in cursor]

    async def get_by_id(self, pick_id: str) -> dict | None:
        from bson import ObjectId

        doc = await self._col.find_one({"_id": ObjectId(pick_id)})
        return _clean(doc) if doc else None


def _from_doc(doc: dict) -> WatchlistHistoryPick:
    snapshots = [
        WatchlistHistorySnapshot(
            date=s["date"],
            trading_day_number=s["trading_day_number"],
            price=s["price"],
            pnl_pct=s["pnl_pct"],
            captured_at=s["captured_at"],
        )
        for s in doc.get("snapshots", [])
    ]
    return WatchlistHistoryPick(
        id=str(doc["_id"]),
        source=doc["source"],
        symbol=doc["symbol"],
        name=doc.get("name", ""),
        sector=doc.get("sector", ""),
        announced_date=doc["announced_date"],
        announced_at=doc.get("announced_at", ""),
        buy_price=float(doc["buy_price"]),
        stop_loss=doc.get("stop_loss"),
        target=doc.get("target"),
        source_ref_id=doc.get("source_ref_id"),
        source_score=doc.get("source_score"),
        window_days=int(doc.get("window_days", 30)),
        trading_day_count=int(doc.get("trading_day_count", 0)),
        frozen=bool(doc.get("frozen", False)),
        frozen_at=doc.get("frozen_at"),
        freeze_reason=doc.get("freeze_reason"),
        last_price=doc.get("last_price"),
        last_pnl_pct=doc.get("last_pnl_pct"),
        last_snapshot_date=doc.get("last_snapshot_date"),
        snapshots=snapshots,
        created_at=doc.get("created_at"),
        updated_at=doc.get("updated_at"),
    )


def _clean(doc: dict) -> dict:
    """Convert MongoDB doc to JSON-serialisable dict."""
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    for snap in doc.get("snapshots", []):
        if isinstance(snap.get("captured_at"), datetime):
            snap["captured_at"] = snap["captured_at"].isoformat()
    return doc
