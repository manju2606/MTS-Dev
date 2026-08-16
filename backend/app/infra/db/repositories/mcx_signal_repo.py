"""MongoDB repository for MCX AI trade signals (see
app/services/mcx_signal_service.py). One document per logged signal --
created when the AI score hits verdict=TRADE with no already-open signal for
that (user, contract, direction), closed once target/stop-loss is hit or it
expires after MCX_SIGNAL_EXPIRY_DAYS.
"""

from __future__ import annotations

from datetime import datetime

import motor.motor_asyncio

from app.core.config import settings

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class McxSignalRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_trade_signals"]

    async def create_signal(self, user_id: str, contract: str, direction: str, data: dict) -> None:
        doc = {
            **data,
            "user_id": user_id,
            "contract": contract.upper(),
            "direction": direction,
            "status": "OPEN",
            "result": None,
        }
        await self._col.insert_one(doc)

    async def get_open_signal(self, user_id: str, contract: str, direction: str) -> dict | None:
        return await self._col.find_one(
            {
                "user_id": user_id,
                "contract": contract.upper(),
                "direction": direction,
                "status": "OPEN",
            }
        )

    async def list_open_signals(self, user_id: str, contract: str) -> list[dict]:
        cursor = self._col.find(
            {"user_id": user_id, "contract": contract.upper(), "status": "OPEN"}
        )
        return [d async for d in cursor]

    async def close_signal(
        self,
        signal_id,
        result: str,
        exit_price: float,
        pnl: float,
        closed_at: datetime,
        days_to_close: float,
    ) -> None:
        await self._col.update_one(
            {"_id": signal_id},
            {
                "$set": {
                    "status": "CLOSED",
                    "result": result,
                    "exit_price": exit_price,
                    "pnl": pnl,
                    "closed_at": closed_at,
                    "days_to_close": days_to_close,
                }
            },
        )

    async def mark_target1_hit(
        self, signal_id, breakeven_stop: float, target_1_hit_at: datetime
    ) -> None:
        """Records a partial exit at target_1 without closing the signal --
        used by two-target strategies (see mcx_silver_strategy_service.py)
        where the position stays OPEN with a reduced quantity and the stop
        moved to breakeven until target_2 or the breakeven stop is hit.
        Single-target strategies (NG/Metals AI Pro) never call this; they go
        straight from OPEN to CLOSED via close_signal()."""
        await self._col.update_one(
            {"_id": signal_id},
            {
                "$set": {
                    "target_1_hit": True,
                    "target_1_hit_at": target_1_hit_at,
                    "stop_loss": breakeven_stop,
                }
            },
        )

    async def list_user_closed_signals_since(
        self, user_id: str, contract: str, since: datetime
    ) -> list[dict]:
        """Every CLOSED signal for this (user, contract) since `since`,
        oldest first -- used by the risk gate (see
        app/domain/services/mcx_silver_risk_gate.py) to derive today's trade
        count, realized P&L, and consecutive-loss streak fresh from actual
        signal outcomes each time, rather than maintaining a separate
        mutable counter that could drift out of sync with what actually
        closed. Not the same as list_closed_signals_since() below (all
        users, for backtest reporting) -- this one is scoped to a single
        user+contract, hence the different name despite similar purpose."""
        cursor = self._col.find(
            {
                "user_id": user_id,
                "contract": contract.upper(),
                "status": "CLOSED",
                "closed_at": {"$gte": since},
            }
        ).sort("closed_at", 1)
        return [d async for d in cursor]

    async def list_signals(self, user_id: str, contract: str, limit: int = 50) -> list[dict]:
        cursor = (
            self._col.find({"user_id": user_id, "contract": contract.upper()})
            .sort("generated_at", -1)
            .limit(limit)
        )
        return [d async for d in cursor]

    async def list_all_signals(self, user_id: str, limit: int = 200) -> list[dict]:
        """Every signal for this user across every contract (NG + Metals
        share this collection) -- for My Trading Dashboard's combined
        signals table, unlike list_signals() above which is scoped to one
        contract at a time for the per-contract MCX page tables."""
        cursor = self._col.find({"user_id": user_id}).sort("generated_at", -1).limit(limit)
        return [d async for d in cursor]

    async def list_closed_signals_since(self, since: datetime) -> list[dict]:
        """Every CLOSED signal (WIN/LOSS/EXPIRED) across all users, closed on
        or after `since` -- for backtest reporting, which evaluates the
        AI scorer itself rather than one user's trading activity."""
        cursor = self._col.find({"status": "CLOSED", "closed_at": {"$gte": since}})
        return [d async for d in cursor]

    async def list_all_since(self, since: datetime | None) -> list[dict]:
        """Every signal (OPEN or CLOSED) across all users, generated on or
        after `since` (all-time if None) -- for the cross-engine Performance
        dashboard's "total calls" count, which needs every signal fired, not
        just the ones that have since resolved."""
        query: dict = {} if since is None else {"generated_at": {"$gte": since}}
        cursor = self._col.find(query)
        return [d async for d in cursor]
