"""MongoDB repository for the latest NG-AI Pro / Metals-AI Pro score per
(user, contract, direction) -- one document per key, overwritten on each
computation.

The 5-min mcx_signal_check / mcx_metals_signal_check scheduler jobs already
compute compute_ng_ai_score()/compute_metal_ai_score() for every tracked
contract and direction (to decide whether to log a new trade signal), then
discard the result. This repo persists that same result instead, so a
live-ish "rank every MCX contract by AI Strength" dashboard (My Trading
Dashboard) can read cached scores instantly rather than recomputing the
full score (candles + yfinance correlation + news) for 24 contracts x 2
directions on every page load/poll -- see mcx_my_dashboard_service.py.
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


class McxScoreCacheRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_score_cache"]

    async def save_score(self, user_id: str, contract: str, direction: str, score: dict) -> None:
        doc = {
            "user_id": user_id,
            "contract": contract.upper(),
            "direction": direction,
            "tradingsymbol": score.get("tradingsymbol"),
            "price": score.get("price"),
            "score_pct": score.get("score_pct"),
            "verdict": score.get("verdict"),
            "updated_at": datetime.utcnow(),
        }
        await self._col.update_one(
            {"user_id": user_id, "contract": contract.upper(), "direction": direction},
            {"$set": doc},
            upsert=True,
        )

    async def get_all_for_user(self, user_id: str) -> list[dict]:
        cursor = self._col.find({"user_id": user_id}, {"_id": 0})
        return [d async for d in cursor]
