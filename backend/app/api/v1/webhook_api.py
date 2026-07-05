"""Webhook subscription management API."""
from __future__ import annotations

import secrets
from dataclasses import asdict
from uuid import uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.domain.models.webhook import WEBHOOK_EVENTS, WebhookSubscription
from app.infra.db.repositories.webhook_repo import WebhookRepository

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


class CreateWebhookBody(BaseModel):
    name: str
    url: str
    events: list[str]


def _serialize(wh: WebhookSubscription, include_secret: bool = False) -> dict:
    d = asdict(wh)
    d["id"] = str(d["id"])
    d["created_at"] = wh.created_at.isoformat()
    d["last_triggered_at"] = wh.last_triggered_at.isoformat() if wh.last_triggered_at else None
    if not include_secret:
        d["secret"] = d["secret"][:8] + "…"   # show only prefix
    return d


@router.get("/events")
async def list_events() -> list[str]:
    return WEBHOOK_EVENTS


@router.get("")
async def list_webhooks(current_user: CurrentUser) -> list[dict]:
    repo = WebhookRepository()
    webhooks = await repo.list_by_user(str(current_user.id))
    return [_serialize(wh) for wh in webhooks]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_webhook(body: CreateWebhookBody, current_user: CurrentUser) -> dict:
    unknown = [e for e in body.events if e not in WEBHOOK_EVENTS]
    if unknown:
        raise HTTPException(400, detail=f"Unknown events: {', '.join(unknown)}. Valid: {', '.join(WEBHOOK_EVENTS)}")
    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(400, detail="url must start with http:// or https://")

    wh = WebhookSubscription(
        id=uuid4(),
        user_id=str(current_user.id),
        url=body.url,
        events=body.events,
        name=body.name.strip(),
        secret=secrets.token_hex(24),
    )
    repo = WebhookRepository()
    await repo.save(wh)
    return _serialize(wh, include_secret=True)  # return full secret once on creation


@router.get("/{wh_id}")
async def get_webhook(wh_id: str, current_user: CurrentUser) -> dict:
    repo = WebhookRepository()
    wh = await repo.get(wh_id)
    if not wh or wh.user_id != str(current_user.id):
        raise HTTPException(404, detail="Webhook not found")
    return _serialize(wh)


@router.delete("/{wh_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(wh_id: str, current_user: CurrentUser) -> None:
    repo = WebhookRepository()
    deleted = await repo.delete(wh_id, str(current_user.id))
    if not deleted:
        raise HTTPException(404, detail="Webhook not found")


@router.patch("/{wh_id}/toggle")
async def toggle_webhook(wh_id: str, current_user: CurrentUser) -> dict:
    repo = WebhookRepository()
    wh = await repo.get(wh_id)
    if not wh or wh.user_id != str(current_user.id):
        raise HTTPException(404, detail="Webhook not found")
    await repo.set_active(wh_id, str(current_user.id), not wh.is_active)
    wh.is_active = not wh.is_active
    return _serialize(wh)


@router.get("/{wh_id}/deliveries")
async def list_deliveries(wh_id: str, current_user: CurrentUser) -> list[dict]:
    repo = WebhookRepository()
    wh = await repo.get(wh_id)
    if not wh or wh.user_id != str(current_user.id):
        raise HTTPException(404, detail="Webhook not found")
    return await repo.list_deliveries(wh_id)
