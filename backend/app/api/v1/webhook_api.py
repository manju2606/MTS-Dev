"""Webhook subscription management API."""
from __future__ import annotations

import secrets
from dataclasses import asdict
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.domain.models.webhook import WEBHOOK_EVENTS, WebhookSubscription
from app.infra.db.repositories.webhook_repo import WebhookRepository

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# One realistic example payload per event, matching the exact shape the
# real dispatch call sites send (alerts.py / live.py) where those exist.
# Used both for the docs-style "example payload" shown in the UI and as
# the actual body sent by the "Send test event" button.
_SAMPLE_PAYLOADS: dict[str, dict] = {
    "alert.triggered": {
        "symbol": "RELIANCE.NS", "direction": "above",
        "price_target": 1400.0, "triggered_price": 1402.35,
    },
    "signal.generated": {
        "symbol": "TCS.NS", "signal": "BUY", "confidence": 0.82,
        "entry_price": 3850.0, "stop_loss": 3780.0, "target": 3990.0,
        "risk_reward_ratio": 2.0, "holding_period": "3-5 days",
        "explanation": "RSI bullish crossover with above-average volume.",
    },
    "trade.executed": {
        "symbol": "INFY.NS", "signal": "BUY", "quantity": 10,
        "broker": "paper", "order_type": "MARKET",
    },
    "discovery.scan_complete": {
        "universe_size": 152, "picks_found": 50,
        "strong_buy_count": 5, "scan_duration_seconds": 12.4,
    },
    "position.stop_hit": {
        "symbol": "SBIN.NS", "entry_price": 800.0, "stop_loss": 780.0,
        "exit_price": 779.5, "pnl": -20.5, "pnl_pct": -2.56,
    },
    "position.target_hit": {
        "symbol": "HDFCBANK.NS", "entry_price": 1650.0, "target": 1700.0,
        "exit_price": 1701.2, "pnl": 51.2, "pnl_pct": 3.10,
    },
}


def sample_payload(event: str) -> dict:
    return _SAMPLE_PAYLOADS.get(event, {"note": f"No example defined for '{event}'"})


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


@router.get("/events/{event}/example")
async def get_event_example(event: str, current_user: CurrentUser) -> dict:
    if event not in WEBHOOK_EVENTS:
        raise HTTPException(400, detail=f"Unknown event: {event}")
    return {
        "event": event,
        "data": sample_payload(event),
        "timestamp": datetime.now(UTC).isoformat(),
    }


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


class TestWebhookBody(BaseModel):
    event: str | None = None


@router.post("/{wh_id}/test")
async def test_webhook(wh_id: str, body: TestWebhookBody, current_user: CurrentUser) -> dict:
    """Fire one real HTTP delivery of a sample payload at the webhook's URL,
    so a user can verify their endpoint before waiting for a real event.
    Recorded in the delivery log like any other attempt.
    """
    repo = WebhookRepository()
    wh = await repo.get(wh_id)
    if not wh or wh.user_id != str(current_user.id):
        raise HTTPException(404, detail="Webhook not found")

    event = body.event or (wh.events[0] if wh.events else "alert.triggered")
    if event not in wh.events:
        raise HTTPException(400, detail=f"'{event}' is not one of this webhook's subscribed events")

    from app.infra.webhooks.dispatcher import deliver_test

    data = sample_payload(event)
    status_code, ok, err = await deliver_test(wh.url, wh.secret, str(wh.id), event, data)
    await repo.record_delivery(str(wh.id), event, status_code, ok, err)

    return {
        "event": event,
        "sample_payload": data,
        "status_code": status_code,
        "ok": ok,
        "error": err,
    }
