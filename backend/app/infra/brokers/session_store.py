"""Broker session store — Redis-backed so a connected broker session
survives backend restarts and is visible across uvicorn worker processes
(this app runs --workers 2; a purely in-memory dict is only visible to
whichever worker happened to handle the /connect request, so the other
worker would see "not connected" even seconds later).

Only Zerodha sessions are persisted -- it's the only broker here whose
credentials (api_key + access_token) are enough to reconstruct a working
client on another worker/after a restart. Kite's own access tokens are
valid for roughly one trading day; a session that's gone stale there will
simply fail on its next API call and prompt a reconnect -- this store
makes no attempt to outlive Kite's own expiry, just to survive *our*
process churn within that window.
"""

import json

from app.core.config import settings
from app.domain.interfaces.broker import AbstractBroker

_REDIS_PREFIX = "broker_session:"
_REDIS_TTL = 20 * 3600  # a little under Kite's ~1-day access token lifetime

# Per-process cache so repeated calls within the same worker/request burst
# don't all round-trip to Redis. Redis remains the source of truth.
_local_cache: dict[str, AbstractBroker] = {}


def _redis():
    import redis.asyncio as aioredis

    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


async def get(user_id: str) -> AbstractBroker | None:
    if user_id in _local_cache:
        return _local_cache[user_id]

    try:
        r = _redis()
        raw = await r.get(_REDIS_PREFIX + user_id)
        await r.aclose()
    except Exception:
        return None
    if not raw:
        return None

    try:
        from app.infra.brokers.zerodha import ZerodhaBroker

        data = json.loads(raw)
        if data.get("broker") != "zerodha":
            return None
        broker = ZerodhaBroker(api_key=data["api_key"], access_token=data["access_token"])
        _local_cache[user_id] = broker
        return broker
    except Exception:
        return None


async def set_broker(user_id: str, broker: AbstractBroker) -> None:
    _local_cache[user_id] = broker

    if broker.name != "zerodha":
        return  # simulated/other brokers carry no reconstructible credentials

    try:
        api_key, access_token = broker.credentials  # type: ignore[attr-defined]
        payload = json.dumps(
            {"broker": "zerodha", "api_key": api_key, "access_token": access_token}
        )
        r = _redis()
        await r.set(_REDIS_PREFIX + user_id, payload, ex=_REDIS_TTL)
        await r.aclose()
    except Exception:
        pass  # local cache above still works for this process; persistence is best-effort


async def remove(user_id: str) -> None:
    _local_cache.pop(user_id, None)
    try:
        r = _redis()
        await r.delete(_REDIS_PREFIX + user_id)
        await r.aclose()
    except Exception:
        pass


def all_sessions() -> dict[str, AbstractBroker]:
    """Local-process sessions only -- used for in-process introspection, not
    a full cross-worker listing (Redis stores raw credentials, not live
    broker instances)."""
    return dict(_local_cache)


async def list_connected_user_ids() -> list[str]:
    """Every user_id with a persisted (Redis) Zerodha session -- used by
    scheduled jobs (e.g. MCX trend alerts) that need to run for all
    connected users, not just whoever hit this worker process."""
    try:
        r = _redis()
        keys = [k async for k in r.scan_iter(match=_REDIS_PREFIX + "*")]
        await r.aclose()
        return [k[len(_REDIS_PREFIX) :] for k in keys]
    except Exception:
        return []
