"""MongoDB repository for MCX day/week extreme-proximity alert state.

Collection: mcx_extreme_alert_state -- one document per (user_id, contract,
level_type), where level_type is one of "day_high"/"day_low"/"week_high"/
"week_low". Tracks whether an alert has already fired for the CURRENT
approach to that level (edge-triggered): fires once when price first comes
within the threshold, then only fires again once price has moved back
outside the threshold and approaches again -- see
mcx_extreme_alert_service.py for the check that uses this.
"""

from datetime import datetime

import motor.motor_asyncio

from app.core.config import settings

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


class McxExtremeAlertRepository:
    @property
    def _col(self) -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
        return _get_db()["mcx_extreme_alert_state"]

    async def is_armed(self, user_id: str, contract: str, level_type: str) -> bool:
        """True if an alert already fired for the current approach to this
        level (i.e. whether to SKIP alerting again right now)."""
        doc = await self._col.find_one(
            {"user_id": user_id, "contract": contract.upper(), "level_type": level_type}
        )
        return bool(doc and doc.get("armed"))

    async def set_armed(self, user_id: str, contract: str, level_type: str, armed: bool) -> None:
        await self._col.update_one(
            {"user_id": user_id, "contract": contract.upper(), "level_type": level_type},
            {"$set": {"armed": armed, "updated_at": datetime.utcnow()}},
            upsert=True,
        )
