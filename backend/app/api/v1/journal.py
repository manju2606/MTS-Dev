"""Trade journal — MongoDB-backed notes per trade."""

from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.core.config import settings

router = APIRouter(prefix="/journal", tags=["journal"])


def _collection():
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    return client[settings.MONGODB_DB]["trade_journal"]


class JournalUpsertRequest(BaseModel):
    notes: str = ""
    rating: int = 3  # 1–5 stars
    tags: list[str] = []


@router.get("/{trade_id}")
async def get_entry(trade_id: str, current_user: CurrentUser) -> dict:
    col = _collection()
    doc = await col.find_one({"trade_id": trade_id, "user_id": str(current_user.id)})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No journal entry")
    doc["_id"] = str(doc["_id"])
    return doc


@router.post("/{trade_id}")
async def upsert_entry(
    trade_id: str,
    body: JournalUpsertRequest,
    current_user: CurrentUser,
) -> dict:
    col = _collection()
    now = datetime.utcnow().isoformat()
    existing = await col.find_one({"trade_id": trade_id, "user_id": str(current_user.id)})
    if existing:
        await col.update_one(
            {"trade_id": trade_id, "user_id": str(current_user.id)},
            {
                "$set": {
                    "notes": body.notes,
                    "rating": body.rating,
                    "tags": body.tags,
                    "updated_at": now,
                }
            },
        )
    else:
        await col.insert_one(
            {
                "trade_id": trade_id,
                "user_id": str(current_user.id),
                "notes": body.notes,
                "rating": body.rating,
                "tags": body.tags,
                "created_at": now,
                "updated_at": now,
            }
        )
    doc = await col.find_one({"trade_id": trade_id, "user_id": str(current_user.id)})
    doc["_id"] = str(doc["_id"])  # type: ignore[index]
    return doc


@router.get("")
async def list_entries(current_user: CurrentUser) -> list[dict]:
    col = _collection()
    docs = await col.find({"user_id": str(current_user.id)}).sort("updated_at", -1).to_list(200)
    for d in docs:
        d["_id"] = str(d["_id"])
    return docs
