"""Organization (multi-client SaaS) endpoints."""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, require_role
from app.domain.models.organization import PLAN_LIMITS, Organization
from app.domain.models.user import UserRole
from app.infra.db.repositories.org_repo import OrgRepository

router = APIRouter(prefix="/org", tags=["organization"])

_admin_only = require_role(UserRole.ADMIN)


class CreateOrgRequest(BaseModel):
    name: str
    plan: str = "free"


class InviteRequest(BaseModel):
    email: str


class UpdatePlanRequest(BaseModel):
    plan: str


def _serialize_org(org: Organization, member_count: int = 0, role: str = "member") -> dict:
    return {
        "id": str(org.id),
        "name": org.name,
        "plan": org.plan,
        "is_active": org.is_active,
        "created_at": org.created_at.isoformat(),
        "member_count": member_count,
        "role": role,
        "limits": org.limits,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_org(body: CreateOrgRequest, current_user: CurrentUser) -> dict:
    if body.plan not in PLAN_LIMITS:
        raise HTTPException(400, detail=f"Invalid plan. Choose: {', '.join(PLAN_LIMITS)}")
    org = Organization(name=body.name.strip(), plan=body.plan, id=uuid4())
    repo = OrgRepository()
    org = await repo.create(org, str(current_user.id))
    return _serialize_org(org, member_count=1, role="owner")


@router.get("/my")
async def get_my_org(current_user: CurrentUser) -> dict | None:
    repo = OrgRepository()
    result = await repo.get_by_user(str(current_user.id))
    if not result:
        return None
    org, role = result
    count = await repo.member_count(str(org.id))
    return _serialize_org(org, member_count=count, role=role)


@router.get("/my/members")
async def list_my_members(current_user: CurrentUser) -> list[dict]:
    repo = OrgRepository()
    result = await repo.get_by_user(str(current_user.id))
    if not result:
        raise HTTPException(404, detail="Not a member of any organization")
    org, _ = result
    return await repo.list_members(str(org.id))


@router.get("/my/invites")
async def list_my_invites(current_user: CurrentUser) -> list[dict]:
    repo = OrgRepository()
    result = await repo.get_by_user(str(current_user.id))
    if not result:
        raise HTTPException(404, detail="Not a member of any organization")
    org, role = result
    if role not in ("owner", "admin"):
        raise HTTPException(403, detail="Only org owners/admins can view invites")
    return await repo.list_invites(str(org.id))


@router.post("/my/invite", status_code=status.HTTP_201_CREATED)
async def invite_member(body: InviteRequest, current_user: CurrentUser) -> dict:
    repo = OrgRepository()
    result = await repo.get_by_user(str(current_user.id))
    if not result:
        raise HTTPException(404, detail="Not a member of any organization")
    org, role = result
    if role not in ("owner", "admin"):
        raise HTTPException(403, detail="Only org owners/admins can invite")
    limits = org.limits
    if limits["max_users"] != -1:
        count = await repo.member_count(str(org.id))
        if count >= limits["max_users"]:
            raise HTTPException(
                422,
                detail=f"Plan limit reached ({limits['max_users']} users). Upgrade to add more.",
            )
    token = await repo.create_invite(str(org.id), body.email.lower().strip(), str(current_user.id))
    return {
        "email": body.email,
        "invite_token": token,
        "message": f"Invite created. Share the token to let {body.email} join.",
    }


@router.delete("/my/invite/{email}")
async def revoke_invite(email: str, current_user: CurrentUser) -> dict:
    repo = OrgRepository()
    result = await repo.get_by_user(str(current_user.id))
    if not result:
        raise HTTPException(404, detail="Not a member of any organization")
    org, role = result
    if role not in ("owner", "admin"):
        raise HTTPException(403, detail="Only org owners/admins can revoke invites")
    await repo.revoke_invite(str(org.id), email.lower())
    return {"revoked": True}


@router.post("/accept-invite")
async def accept_invite(token: str, current_user: CurrentUser) -> dict:
    repo = OrgRepository()
    org_id = await repo.accept_invite(token, str(current_user.id))
    if not org_id:
        raise HTTPException(400, detail="Invite token is invalid or already used")
    return {"joined": True, "org_id": org_id}


@router.patch("/my/plan")
async def update_plan(body: UpdatePlanRequest, current_user: CurrentUser) -> dict:
    if body.plan not in PLAN_LIMITS:
        raise HTTPException(400, detail=f"Invalid plan. Choose: {', '.join(PLAN_LIMITS)}")
    repo = OrgRepository()
    result = await repo.get_by_user(str(current_user.id))
    if not result:
        raise HTTPException(404, detail="Not a member of any organization")
    org, role = result
    if role != "owner":
        raise HTTPException(403, detail="Only the org owner can change the plan")
    updated = await repo.update_plan(str(org.id), body.plan)
    if not updated:
        raise HTTPException(500, detail="Failed to update plan")
    count = await repo.member_count(str(org.id))
    return _serialize_org(updated, member_count=count, role=role)


# ── Super-admin endpoints (admin role only) ───────────────────────────────────


@router.get("/admin/all")
async def list_all_orgs(current_user: CurrentUser) -> list[dict]:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(403, detail="Admin only")
    repo = OrgRepository()
    docs = await repo.list_all()
    result = []
    for doc in docs:
        count = await repo.member_count(doc["id"])
        result.append({**doc, "member_count": count})
    return result


@router.patch("/admin/{org_id}/plan")
async def admin_set_plan(org_id: str, body: UpdatePlanRequest, current_user: CurrentUser) -> dict:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(403, detail="Admin only")
    if body.plan not in PLAN_LIMITS:
        raise HTTPException(400, detail="Invalid plan")
    repo = OrgRepository()
    updated = await repo.update_plan(org_id, body.plan)
    if not updated:
        raise HTTPException(404, detail="Organization not found")
    return _serialize_org(updated)
