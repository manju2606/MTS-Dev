"""MongoDB-backed repository for user portfolio holdings (actual brokerage positions).

Supports multiple named portfolios per user via portfolio_id.
"""

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

    @property
    def _meta(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["portfolio_meta"]

    # ── Portfolio CRUD ────────────────────────────────────────────────────────

    async def list_portfolios(self, user_id: str) -> list[dict]:
        """Return all named portfolios for a user, plus a count of holdings in each."""
        try:
            cursor = self._meta.find({"user_id": user_id}).sort("created_at", 1)
            portfolios = []
            async for doc in cursor:
                pid = doc["portfolio_id"]
                count = await self._col.count_documents({"user_id": user_id, "portfolio_id": pid})
                portfolios.append({
                    "id": str(doc["_id"]),
                    "portfolio_id": pid,
                    "name": doc["name"],
                    "created_at": doc.get("created_at", "").isoformat() if isinstance(doc.get("created_at"), datetime) else "",
                    "holdings_count": count,
                })
            # If user has no portfolios but has legacy holdings (no portfolio_id), surface a default
            if not portfolios:
                legacy = await self._col.count_documents({"user_id": user_id})
                if legacy > 0:
                    portfolios.append({
                        "id": "default",
                        "portfolio_id": "default",
                        "name": "My Portfolio",
                        "created_at": "",
                        "holdings_count": legacy,
                    })
            return portfolios
        except Exception as exc:
            log.error("portfolios.list_error", error=str(exc))
            return []

    async def create_portfolio(self, user_id: str, name: str) -> dict:
        import re
        slug = re.sub(r"[^a-z0-9-]", "-", name.lower().strip())[:40] or "portfolio"
        # Ensure unique slug per user
        existing = await self._meta.count_documents({"user_id": user_id, "portfolio_id": slug})
        if existing:
            slug = f"{slug}-{int(datetime.utcnow().timestamp())}"
        doc = {
            "user_id": user_id,
            "portfolio_id": slug,
            "name": name.strip(),
            "created_at": datetime.utcnow(),
        }
        await self._meta.insert_one(doc)
        doc["id"] = str(doc.pop("_id"))
        return doc

    async def rename_portfolio(self, user_id: str, portfolio_id: str, new_name: str) -> bool:
        try:
            res = await self._meta.update_one(
                {"user_id": user_id, "portfolio_id": portfolio_id},
                {"$set": {"name": new_name.strip(), "updated_at": datetime.utcnow()}},
            )
            return res.modified_count > 0
        except Exception as exc:
            log.error("portfolio.rename_error", error=str(exc))
            return False

    async def delete_portfolio(self, user_id: str, portfolio_id: str) -> int:
        """Delete all holdings in a portfolio and remove its meta entry."""
        try:
            res = await self._col.delete_many({"user_id": user_id, "portfolio_id": portfolio_id})
            await self._meta.delete_one({"user_id": user_id, "portfolio_id": portfolio_id})
            return res.deleted_count
        except Exception as exc:
            log.error("portfolio.delete_error", error=str(exc))
            return 0

    # ── Holdings CRUD (portfolio-aware) ───────────────────────────────────────

    async def list_holdings(self, user_id: str, portfolio_id: str = "default") -> list[dict]:
        try:
            # Match either exact portfolio_id or legacy docs with no portfolio_id (treat as "default")
            if portfolio_id == "default":
                query = {"user_id": user_id, "$or": [
                    {"portfolio_id": "default"},
                    {"portfolio_id": {"$exists": False}},
                ]}
            else:
                query = {"user_id": user_id, "portfolio_id": portfolio_id}
            cursor = self._col.find(query).sort("symbol", 1)
            docs = []
            async for doc in cursor:
                doc["id"] = str(doc.pop("_id"))
                doc.setdefault("portfolio_id", "default")
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
        portfolio_id: str = "default",
    ) -> dict | None:
        doc = {
            "user_id": user_id,
            "portfolio_id": portfolio_id,
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

    async def bulk_upsert(self, user_id: str, rows: list[dict], portfolio_id: str = "default") -> int:
        """Replace all holdings for a user+portfolio with the supplied list."""
        try:
            await self._col.delete_many({"user_id": user_id, "portfolio_id": portfolio_id})
            if not rows:
                return 0
            now = datetime.utcnow()
            docs = [
                {
                    "user_id": user_id,
                    "portfolio_id": portfolio_id,
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
