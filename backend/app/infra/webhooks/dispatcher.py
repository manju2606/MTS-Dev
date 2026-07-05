"""Async webhook delivery — fires and forgets HTTP POST to subscriber URLs."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
from datetime import UTC, datetime

import httpx
import structlog

log = structlog.get_logger()

_TIMEOUT = 10.0
_MAX_RETRIES = 2


def _sign(secret: str, payload: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


async def _deliver_one(url: str, secret: str, wh_id: str, event: str, data: dict) -> tuple[int | None, bool, str]:
    body = json.dumps({"event": event, "data": data, "timestamp": datetime.now(UTC).isoformat()}).encode()
    sig = _sign(secret, body)
    headers = {
        "Content-Type": "application/json",
        "X-MTS-Event": event,
        "X-MTS-Signature": sig,
        "X-MTS-Webhook-Id": wh_id,
        "X-MTS-Timestamp": str(int(time.time())),
    }
    for attempt in range(_MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(url, content=body, headers=headers)
                ok = 200 <= resp.status_code < 300
                return resp.status_code, ok, "" if ok else f"HTTP {resp.status_code}"
        except Exception as exc:
            if attempt == _MAX_RETRIES:
                return None, False, str(exc)
            await asyncio.sleep(2 ** attempt)
    return None, False, "max retries"


async def dispatch(event: str, data: dict) -> None:
    """Dispatch event to all active subscribers. Call fire-and-forget."""
    from app.infra.db.repositories.webhook_repo import WebhookRepository
    repo = WebhookRepository()
    try:
        subscribers = await repo.list_for_event(event)
    except Exception as exc:
        log.warning("webhook.dispatch.list_failed", event=event, error=str(exc))
        return

    if not subscribers:
        return

    async def _fire(sub) -> None:  # type: ignore[no-untyped-def]
        status, ok, err = await _deliver_one(sub.url, sub.secret, str(sub.id), event, data)
        await repo.record_delivery(str(sub.id), event, status, ok, err)
        log.info("webhook.delivered", wh_id=str(sub.id), event=event, ok=ok, status=status)

    await asyncio.gather(*[_fire(s) for s in subscribers], return_exceptions=True)


def fire(event: str, data: dict) -> None:
    """Schedule dispatch without awaiting — safe to call from sync or non-async context."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(dispatch(event, data))
        else:
            loop.run_until_complete(dispatch(event, data))
    except Exception as exc:
        log.warning("webhook.fire.failed", event=event, error=str(exc))
