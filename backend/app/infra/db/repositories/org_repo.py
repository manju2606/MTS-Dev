"""MongoDB repository for organizations — multi-client SaaS."""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
from uuid import UUID, uuid4

import motor.motor_asyncio
import structlog

from app.core.config import settings
from app.domain.models.organization import Organization

log = structlog.get_logger()

_client: motor.motor_asyncio.AsyncIOMotorClient | None = None  # type: ignore[type-arg]


def _get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:  # type: ignore[type-arg]
    global _client
    if _client is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _client[settings.MONGODB_DB]


def _col() -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
    return _get_db()["organizations"]


def _member_col() -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
    return _get_db()["org_members"]


def _invite_col() -> motor.motor_asyncio.AsyncIOMotorCollection:  # type: ignore[type-arg]
    return _get_db()["org_invites"]


def _org_from_doc(doc: dict) -> Organization:
    return Organization(
        id=UUID(doc["id"]),
        name=doc["name"],
        plan=doc.get("plan", "free"),
        is_active=doc.get("is_active", True),
        created_at=doc.get("created_at", datetime.now(UTC)),
    )


class OrgRepository:
    async def create(self, org: Organization, owner_user_id: str) -> Organization:
        doc = asdict(org)
        doc["id"] = str(org.id)
        doc["created_at"] = org.created_at.isoformat()
        await _col().insert_one(doc)
        await _member_col().update_one(
            {"org_id": str(org.id), "user_id": owner_user_id},
            {
                "$set": {
                    "org_id": str(org.id),
                    "user_id": owner_user_id,
                    "role": "owner",
                    "joined_at": datetime.now(UTC).isoformat(),
                }
            },
            upsert=True,
        )
        log.info("org.created", org_id=str(org.id), name=org.name)
        return org

    async def get_by_id(self, org_id: str) -> Organization | None:
        doc = await _col().find_one({"id": org_id}, {"_id": 0})
        return _org_from_doc(doc) if doc else None

    async def get_by_user(self, user_id: str) -> tuple[Organization, str] | None:
        """Return (org, member_role) for the user's first org membership."""
        member = await _member_col().find_one({"user_id": user_id})
        if not member:
            return None
        org = await self.get_by_id(member["org_id"])
        return (org, member.get("role", "member")) if org else None

    async def list_all(self, limit: int = 100) -> list[dict]:
        cursor = _col().find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
        docs = await cursor.to_list(length=limit)
        return docs

    async def update_plan(self, org_id: str, plan: str) -> Organization | None:
        await _col().update_one({"id": org_id}, {"$set": {"plan": plan}})
        return await self.get_by_id(org_id)

    async def set_active(self, org_id: str, active: bool) -> None:
        await _col().update_one({"id": org_id}, {"$set": {"is_active": active}})

    # ── Members ──────────────────────────────────────────────────────────────

    async def list_members(self, org_id: str) -> list[dict]:
        cursor = _member_col().find({"org_id": org_id}, {"_id": 0})
        return await cursor.to_list(length=500)

    async def add_member(self, org_id: str, user_id: str, role: str = "member") -> None:
        await _member_col().update_one(
            {"org_id": org_id, "user_id": user_id},
            {
                "$set": {
                    "org_id": org_id,
                    "user_id": user_id,
                    "role": role,
                    "joined_at": datetime.now(UTC).isoformat(),
                }
            },
            upsert=True,
        )

    async def remove_member(self, org_id: str, user_id: str) -> None:
        await _member_col().delete_one({"org_id": org_id, "user_id": user_id})

    async def member_count(self, org_id: str) -> int:
        return await _member_col().count_documents({"org_id": org_id})

    # ── Invites ──────────────────────────────────────────────────────────────

    async def create_invite(self, org_id: str, email: str, invited_by: str) -> str:
        token = str(uuid4())
        await _invite_col().update_one(
            {"org_id": org_id, "email": email},
            {
                "$set": {
                    "org_id": org_id,
                    "email": email,
                    "invited_by": invited_by,
                    "token": token,
                    "accepted": False,
                    "created_at": datetime.now(UTC).isoformat(),
                }
            },
            upsert=True,
        )
        return token

    async def list_invites(self, org_id: str) -> list[dict]:
        cursor = _invite_col().find({"org_id": org_id}, {"_id": 0})
        return await cursor.to_list(length=200)

    async def revoke_invite(self, org_id: str, email: str) -> None:
        await _invite_col().delete_one({"org_id": org_id, "email": email})

    async def accept_invite(self, token: str, user_id: str) -> str | None:
        """Accept an invite by token; returns org_id on success."""
        doc = await _invite_col().find_one({"token": token, "accepted": False})
        if not doc:
            return None
        org_id = doc["org_id"]
        await self.add_member(org_id, user_id)
        await _invite_col().update_one({"token": token}, {"$set": {"accepted": True}})
        return org_id
