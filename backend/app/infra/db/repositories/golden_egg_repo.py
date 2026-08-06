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
        doc = {
            "scan_date": scan_date,
            "pick": dataclasses.asdict(pick) if pick else None,
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

    async def get_all_for_date(self, date_str: str) -> list[dict]:
        """Every run for `date_str` (oldest first) -- unlike get_by_date
        (latest only), used by watchlist_history_service.ingest_todays_picks
        so a symbol picked on an earlier same-day run isn't missed just
        because a later run picked something else."""
        cursor = self._col.find({"scan_date": date_str}).sort("created_at", 1)
        return [_clean(doc) async for doc in cursor]


def _clean(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    if "created_at" in doc and isinstance(doc["created_at"], datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    if "updated_at" in doc and isinstance(doc["updated_at"], datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()
    return doc
