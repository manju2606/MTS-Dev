"""Admin audit log — read-only access for admins."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, require_role
from app.domain.models.user import UserRole
from app.infra.db.repositories import audit_repo

router = APIRouter(prefix="/admin/audit", tags=["audit"])

_admin_only = require_role(UserRole.ADMIN)


def _ev_dict(e) -> dict:
    return {
        "id": str(e.id),
        "user_id": e.user_id,
        "action": e.action,
        "resource": e.resource,
        "details": e.details,
        "ip": e.ip,
        "created_at": e.created_at.isoformat(),
    }


@router.get("")
async def list_audit(
    _: CurrentUser = _admin_only,
    user_id: str | None = Query(default=None),
    action: str | None = Query(default=None, description="Partial match"),
    limit: int = Query(default=100, le=500),
    skip: int = Query(default=0),
) -> dict:
    events = await audit_repo.list_events(user_id=user_id, action=action, limit=limit, skip=skip)
    total = await audit_repo.total_count(user_id=user_id, action=action)
    return {"total": total, "events": [_ev_dict(e) for e in events]}
