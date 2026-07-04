"""MongoDB-backed repository for user portfolio holdings (actual brokerage positions)."""

from datetime import datetime

import motor.motor_asyncio
import structlog
from bson import ObjectId

from app.core.config import settings

log = structlog.get_logger()
_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class HoldingsRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["portfolio_holdings"]

    async def list_holdings(self, user_id: str) -> list[dict]:
        try:
            cursor = self._col.find({"user_id": user_id}).sort("symbol", 1)
            docs = []
            async for doc in cursor:
                doc["id"] = str(doc.pop("_id"))
                docs.append(doc)
            return docs
        except Exception as exc:
            log.error("holdings.list_error", error=str(exc))
            return []

    async def add_holding(
        self,
        user_id: str,
        symbol: str,
        name: str,
        qty: int,
        avg_price: float,
        buy_date: str | None,
        sector: str,
    ) -> dict | None:
        doc = {
            "user_id": user_id,
            "symbol": symbol,
            "name": name,
            "qty": qty,
            "avg_price": avg_price,
            "buy_date": buy_date,
            "sector": sector,
            "created_at": datetime.utcnow(),
        }
        try:
            result = await self._col.insert_one(doc)
            doc["id"] = str(result.inserted_id)
            doc.pop("_id", None)
            return doc
        except Exception as exc:
            log.error("holdings.add_error", error=str(exc))
            return None

    async def update_holding(
        self, user_id: str, holding_id: str, qty: int, avg_price: float
    ) -> bool:
        try:
            res = await self._col.update_one(
                {"_id": ObjectId(holding_id), "user_id": user_id},
                {"$set": {"qty": qty, "avg_price": avg_price, "updated_at": datetime.utcnow()}},
            )
            return res.modified_count > 0
        except Exception as exc:
            log.error("holdings.update_error", error=str(exc))
            return False

    async def delete_holding(self, user_id: str, holding_id: str) -> bool:
        try:
            res = await self._col.delete_one(
                {"_id": ObjectId(holding_id), "user_id": user_id}
            )
            return res.deleted_count > 0
        except Exception as exc:
            log.error("holdings.delete_error", error=str(exc))
            return False

    async def bulk_upsert(self, user_id: str, rows: list[dict]) -> int:
        """Replace all holdings for a user with the supplied list."""
        try:
            await self._col.delete_many({"user_id": user_id})
            if not rows:
                return 0
            now = datetime.utcnow()
            docs = [
                {
                    "user_id": user_id,
                    "symbol": r["symbol"],
                    "name": r.get("name", r["symbol"]),
                    "qty": r["qty"],
                    "avg_price": r["avg_price"],
                    "buy_date": r.get("buy_date"),
                    "sector": r.get("sector", "Other"),
                    "created_at": now,
                }
                for r in rows
            ]
            await self._col.insert_many(docs)
            return len(docs)
        except Exception as exc:
            log.error("holdings.bulk_error", error=str(exc))
            return 0
