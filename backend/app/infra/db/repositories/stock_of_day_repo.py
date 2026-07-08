"""MongoDB repository for Stock-of-the-Day records.

Collection: stock_of_day (in mts_journal DB)
Index: date (unique, descending)
"""

from datetime import datetime

import motor.motor_asyncio
import structlog

from app.core.config import settings
from app.domain.models.stock_of_day import SotDSettings, StockOfDay

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class StockOfDayRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["stock_of_day"]

    @property
    def _journal(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["sotd_journal"]

    # ── CRUD ─────────────────────────────────────────────────────────────────

    async def save(self, sotd: StockOfDay) -> StockOfDay:
        doc = _to_doc(sotd)
        doc["updated_at"] = datetime.utcnow()
        result = await self._col.insert_one(doc)
        sotd.id = str(result.inserted_id)
        return sotd

    async def update(self, sotd: StockOfDay) -> None:
        from bson import ObjectId

        if not sotd.id:
            return
        patch = {
            "status": sotd.status,
            "auto_traded": sotd.auto_traded,
            "paper_trade_id": sotd.paper_trade_id,
            "auto_trade_user_id": sotd.auto_trade_user_id,
            "exit_price": sotd.exit_price,
            "exit_time": sotd.exit_time,
            "pnl_pct": sotd.pnl_pct,
            "outcome": sotd.outcome,
            "updated_at": datetime.utcnow(),
        }
        await self._col.update_one(
            {"_id": ObjectId(sotd.id)},
            {"$set": patch},
        )

    async def get_by_date(self, date_str: str) -> StockOfDay | None:
        doc = await self._col.find_one({"date": date_str})
        return _from_doc(doc) if doc else None

    async def get_by_trade_id(self, paper_trade_id: str) -> StockOfDay | None:
        doc = await self._col.find_one({"paper_trade_id": paper_trade_id})
        return _from_doc(doc) if doc else None

    async def list_history(self, limit: int = 30) -> list[StockOfDay]:
        cursor = self._col.find().sort("date", -1).limit(limit)
        return [_from_doc(d) async for d in cursor]

    async def list_trading(self) -> list[StockOfDay]:
        """All picks currently in TRADING status (for price check)."""
        cursor = self._col.find({"status": "TRADING"})
        return [_from_doc(d) async for d in cursor]

    async def get_resolved_picks_between(self, start_date: str, end_date: str) -> list[dict]:
        """Flat list of resolved picks in a date range, for cross-engine
        report comparisons (see dsws_service.get_report). One entry per day
        since Stock of the Day generates a single pick per date."""
        cursor = self._col.find(
            {"date": {"$gte": start_date, "$lte": end_date}, "outcome": {"$ne": None}},
            {"symbol": 1, "name": 1, "date": 1, "pnl_pct": 1},
        )
        return [
            {
                "symbol": doc["symbol"],
                "name": doc.get("name", doc["symbol"]),
                "scan_date": doc["date"],
                "pct_change": doc["pnl_pct"],
            }
            async for doc in cursor
        ]

    # ── Journal entries ───────────────────────────────────────────────────────

    async def add_journal_entry(
        self,
        date_str: str,
        event: str,
        details: dict,
    ) -> None:
        await self._journal.insert_one(
            {
                "date": date_str,
                "event": event,
                "details": details,
                "logged_at": datetime.utcnow(),
            }
        )

    async def get_journal(self, date_str: str) -> list[dict]:
        cursor = self._journal.find({"date": date_str}).sort("logged_at", 1)
        entries = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            entries.append(doc)
        return entries

    async def count_auto_trades_today(self, date_str: str) -> int:
        """Count how many auto-trades were placed for a given date."""
        return await self._col.count_documents({"date": date_str, "auto_traded": True})

    # ── Settings ──────────────────────────────────────────────────────────────

    @property
    def _settings_col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["sotd_settings"]

    async def get_settings(self) -> SotDSettings:
        doc = await self._settings_col.find_one({"_id": "singleton"})
        if not doc:
            return SotDSettings()
        return SotDSettings(
            auto_trade_enabled=bool(doc.get("auto_trade_enabled", True)),
            threshold=float(doc.get("threshold", 85.0)),
            max_daily_trades=int(doc.get("max_daily_trades", 1)),
            market_hours_only=bool(doc.get("market_hours_only", True)),
            paper_trade_quantity=float(doc.get("paper_trade_quantity", 1.0)),
            quantity_type=str(doc.get("quantity_type", "qty")),
            paper_capital=float(doc.get("paper_capital", 100000.0)),
        )

    async def save_settings(self, cfg: SotDSettings) -> SotDSettings:
        await self._settings_col.update_one(
            {"_id": "singleton"},
            {
                "$set": {
                    "auto_trade_enabled": cfg.auto_trade_enabled,
                    "threshold": cfg.threshold,
                    "max_daily_trades": cfg.max_daily_trades,
                    "market_hours_only": cfg.market_hours_only,
                    "paper_trade_quantity": cfg.paper_trade_quantity,
                    "quantity_type": cfg.quantity_type,
                    "paper_capital": cfg.paper_capital,
                    "updated_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )
        return cfg


# ── Serialisation ─────────────────────────────────────────────────────────────


def _to_doc(s: StockOfDay) -> dict:
    return {
        "date": s.date,
        "generated_at": s.generated_at,
        "symbol": s.symbol,
        "name": s.name,
        "sector": s.sector,
        "discovery_score": s.discovery_score,
        "discovery_signal": s.discovery_signal,
        "scanner_hits": s.scanner_hits,
        "forecast_direction": s.forecast_direction,
        "composite_score": s.composite_score,
        "confidence": s.confidence,
        "entry_price": s.entry_price,
        "stop_loss": s.stop_loss,
        "target": s.target,
        "risk_reward": s.risk_reward,
        "holding_period": s.holding_period,
        "explanation": s.explanation,
        "auto_traded": s.auto_traded,
        "paper_trade_id": s.paper_trade_id,
        "auto_trade_user_id": s.auto_trade_user_id,
        "quantity": s.quantity,
        "status": s.status,
        "exit_price": s.exit_price,
        "exit_time": s.exit_time,
        "pnl_pct": s.pnl_pct,
        "outcome": s.outcome,
    }


def _from_doc(doc: dict) -> StockOfDay:
    return StockOfDay(
        id=str(doc["_id"]),
        date=doc["date"],
        generated_at=doc.get("generated_at", ""),
        symbol=doc["symbol"],
        name=doc.get("name", ""),
        sector=doc.get("sector", ""),
        discovery_score=float(doc.get("discovery_score", 0)),
        discovery_signal=doc.get("discovery_signal", ""),
        scanner_hits=doc.get("scanner_hits", []),
        forecast_direction=doc.get("forecast_direction", "N/A"),
        composite_score=float(doc.get("composite_score", 0)),
        confidence=float(doc.get("confidence", 0)),
        entry_price=float(doc.get("entry_price", 0)),
        stop_loss=float(doc.get("stop_loss", 0)),
        target=float(doc.get("target", 0)),
        risk_reward=float(doc.get("risk_reward", 0)),
        holding_period=doc.get("holding_period", ""),
        explanation=doc.get("explanation", ""),
        auto_traded=bool(doc.get("auto_traded", False)),
        paper_trade_id=doc.get("paper_trade_id"),
        auto_trade_user_id=doc.get("auto_trade_user_id"),
        quantity=int(doc.get("quantity", 1)),
        status=doc.get("status", "WATCHING"),
        exit_price=doc.get("exit_price"),
        exit_time=doc.get("exit_time"),
        pnl_pct=doc.get("pnl_pct"),
        outcome=doc.get("outcome"),
    )
