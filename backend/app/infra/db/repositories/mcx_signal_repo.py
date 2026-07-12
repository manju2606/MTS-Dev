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

    async def list_signals(self, user_id: str, contract: str, limit: int = 50) -> list[dict]:
        cursor = (
            self._col.find({"user_id": user_id, "contract": contract.upper()})
            .sort("generated_at", -1)
            .limit(limit)
        )
        return [d async for d in cursor]

    async def list_closed_signals_since(self, since: datetime) -> list[dict]:
        """Every CLOSED signal (WIN/LOSS/EXPIRED) across all users, closed on
        or after `since` -- for backtest reporting, which evaluates the
        AI scorer itself rather than one user's trading activity."""
        cursor = self._col.find({"status": "CLOSED", "closed_at": {"$gte": since}})
        return [d async for d in cursor]
