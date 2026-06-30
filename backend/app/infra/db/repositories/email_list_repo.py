"""MongoDB-backed repository for report email recipients."""

from datetime import datetime

import structlog
from bson import ObjectId

from app.core.config import settings

log = structlog.get_logger()


class EmailListRepository:
    def __init__(self) -> None:
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(settings.MONGODB_URL)
        db = client[settings.MONGODB_DB]
        self._col = db["email_recipients"]

    def _doc(self, raw: dict) -> dict:
        return {
            "id": str(raw["_id"]),
            "email": raw["email"],
            "label": raw.get("label", ""),
            "active": raw.get("active", True),
            "added_at": raw["added_at"].isoformat() if isinstance(raw.get("added_at"), datetime) else raw.get("added_at"),
        }

    async def list_all(self) -> list[dict]:
        cursor = self._col.find().sort("added_at", 1)
        return [self._doc(d) async for d in cursor]

    async def list_active_emails(self) -> list[str]:
        cursor = self._col.find({"active": True}, {"email": 1})
        return [d["email"] async for d in cursor]

    async def get_by_email(self, email: str) -> dict | None:
        doc = await self._col.find_one({"email": email.lower()})
        return self._doc(doc) if doc else None

    async def add(self, email: str, label: str = "") -> dict:
        doc = {
            "email": email.lower(),
            "label": label,
            "active": True,
            "added_at": datetime.utcnow(),
        }
        result = await self._col.insert_one(doc)
        doc["_id"] = result.inserted_id
        log.info("email_list.added", email=email)
        return self._doc(doc)

    async def remove(self, email_id: str) -> bool:
        try:
            result = await self._col.delete_one({"_id": ObjectId(email_id)})
            return result.deleted_count > 0
        except Exception:
            return False

    async def toggle_active(self, email_id: str) -> dict | None:
        try:
            doc = await self._col.find_one({"_id": ObjectId(email_id)})
            if not doc:
                return None
            new_state = not doc.get("active", True)
            await self._col.update_one({"_id": ObjectId(email_id)}, {"$set": {"active": new_state}})
            doc["active"] = new_state
            return self._doc(doc)
        except Exception:
            return None
