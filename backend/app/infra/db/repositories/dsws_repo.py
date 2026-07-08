"""MongoDB repository for DSWS (Daily Discovery Watchlist Summary) records.

Collection: dsws_scans (in mts_journal DB) — one document per trading day,
one array of picks per signal bucket. Generation is append-only: a symbol
already present in a bucket for the day is left untouched by a re-run.
"""

import dataclasses
from datetime import datetime

import motor.motor_asyncio
import structlog

from app.core.config import settings
from app.domain.models.dsws import DSWS_BUCKETS, DswsCheckpoint, DswsPick

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class DswsRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["dsws_scans"]

    async def upsert_picks(self, scan_date: str, bucket: str, picks: list[DswsPick]) -> int:
        """Append only the symbols not already present in this bucket for this
        date. Returns the number of newly-added picks."""
        if bucket not in DSWS_BUCKETS:
            raise ValueError(f"unknown DSWS bucket: {bucket}")
        if not picks:
            return 0

        now = datetime.utcnow()
        await self._col.update_one(
            {"scan_date": scan_date},
            {
                "$setOnInsert": {
                    "scan_date": scan_date,
                    "generated_at": now,
                    "closed_out": False,
                    **{f"buckets.{b}": [] for b in DSWS_BUCKETS},
                }
            },
            upsert=True,
        )

        doc = await self._col.find_one(
            {"scan_date": scan_date}, {f"buckets.{bucket}.symbol": 1}
        )
        existing_symbols = {p["symbol"] for p in (doc or {}).get("buckets", {}).get(bucket, [])}
        new_docs = [_pick_to_doc(p) for p in picks if p.symbol not in existing_symbols]
        if not new_docs:
            return 0

        await self._col.update_one(
            {"scan_date": scan_date},
            {"$push": {f"buckets.{bucket}": {"$each": new_docs}}, "$set": {"updated_at": now}},
        )
        return len(new_docs)

    async def add_checkpoint(
        self, scan_date: str, bucket: str, symbol: str, checkpoint: DswsCheckpoint
    ) -> None:
        await self._col.update_one(
            {"scan_date": scan_date, f"buckets.{bucket}.symbol": symbol},
            {
                "$push": {f"buckets.{bucket}.$.checkpoints": _checkpoint_to_doc(checkpoint)},
                "$set": {"updated_at": datetime.utcnow()},
            },
        )

    async def set_close(
        self, scan_date: str, bucket: str, symbol: str, close_price: float, close_pct: float
    ) -> None:
        await self._col.update_one(
            {"scan_date": scan_date, f"buckets.{bucket}.symbol": symbol},
            {
                "$set": {
                    f"buckets.{bucket}.$.close_price": close_price,
                    f"buckets.{bucket}.$.close_pct": close_pct,
                }
            },
        )

    async def mark_closed_out(self, scan_date: str) -> None:
        await self._col.update_one(
            {"scan_date": scan_date},
            {"$set": {"closed_out": True, "updated_at": datetime.utcnow()}},
        )

    async def get_scan_by_date(self, scan_date: str) -> dict | None:
        doc = await self._col.find_one({"scan_date": scan_date})
        if doc is None:
            return None
        return _clean(doc)

    async def get_scans_between(self, start_date: str, end_date: str) -> list[dict]:
        """Inclusive range, both bounds are 'YYYY-MM-DD' strings — safe to
        compare lexicographically since the format is zero-padded."""
        cursor = self._col.find(
            {"scan_date": {"$gte": start_date, "$lte": end_date}}
        ).sort("scan_date", 1)
        return [_clean(doc) async for doc in cursor]


def _pick_to_doc(p: DswsPick) -> dict:
    doc = dataclasses.asdict(p)
    doc["checkpoints"] = [_checkpoint_to_doc(c) for c in p.checkpoints]
    return doc


def _checkpoint_to_doc(c: DswsCheckpoint) -> dict:
    return dataclasses.asdict(c)


def _clean(doc: dict) -> dict:
    """Convert MongoDB doc to JSON-serialisable dict."""
    doc["id"] = str(doc.pop("_id"))
    for key in ("generated_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    for bucket_picks in doc.get("buckets", {}).values():
        for pick in bucket_picks:
            if isinstance(pick.get("added_at"), datetime):
                pick["added_at"] = pick["added_at"].isoformat()
            for cp in pick.get("checkpoints", []):
                if isinstance(cp.get("captured_at"), datetime):
                    cp["captured_at"] = cp["captured_at"].isoformat()
    return doc
