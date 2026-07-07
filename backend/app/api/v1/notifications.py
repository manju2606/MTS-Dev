"""Notification center — list, read, clear."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.infra.db.repositories import notification_repo

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _n_dict(n) -> dict:
    return {
        "id": str(n.id),
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "link": n.link,
        "read": n.read,
        "created_at": n.created_at.isoformat(),
    }


@router.get("")
async def list_notifications(current_user: CurrentUser) -> list[dict]:
    items = await notification_repo.list_by_user(str(current_user.id))
    return [_n_dict(n) for n in items]


@router.get("/unread-count")
async def unread_count(current_user: CurrentUser) -> dict:
    count = await notification_repo.unread_count(str(current_user.id))
    return {"count": count}


@router.patch("/{notification_id}/read")
async def mark_read(notification_id: str, current_user: CurrentUser) -> dict:
    ok = await notification_repo.mark_read(notification_id, str(current_user.id))
    return {"ok": ok}


@router.post("/read-all")
async def read_all(current_user: CurrentUser) -> dict:
    updated = await notification_repo.mark_all_read(str(current_user.id))
    return {"updated": updated}


@router.delete("/clear")
async def clear(current_user: CurrentUser) -> dict:
    deleted = await notification_repo.clear_all(str(current_user.id))
    return {"deleted": deleted}
