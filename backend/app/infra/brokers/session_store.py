"""Broker session store — Redis-backed so a connected broker session
survives backend restarts and is visible across uvicorn worker processes
(this app runs --workers 2; a purely in-memory dict is only visible to
whichever worker happened to handle the /connect request, so the other
worker would see "not connected" even seconds later).

Every live broker (Zerodha, Upstox, Alice Blue, Dhan) persists via its
`credentials` dict (see AbstractBroker) -- the simulated broker has none,
so set_broker() below just skips it. Each broker's own access token expiry
still applies (Kite ~1 day, Dhan 24h, etc.); this store makes no attempt to
outlive that, just to survive *our* process churn within that window.
"""

import json

from app.core.config import settings
from app.domain.interfaces.broker import AbstractBroker

_REDIS_PREFIX = "broker_session:"
_REDIS_TTL = 20 * 3600  # a little under the shortest-lived token (Kite/Dhan, ~1 day)

# Per-process cache so repeated calls within the same worker/request burst
# don't all round-trip to Redis. Redis remains the source of truth.
_local_cache: dict[str, AbstractBroker] = {}


def _redis():
    import redis.asyncio as aioredis

    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


def _reconstruct(data: dict) -> AbstractBroker | None:
    broker_name = data.get("broker")
    # Old sessions (written before credentials were nested) stored api_key /
    # access_token directly on `data` -- fall back to that shape too so an
    # already-connected user isn't forced to reconnect after this change.
    creds = data.get("credentials") or data

    if broker_name == "zerodha":
        from app.infra.brokers.zerodha import ZerodhaBroker

        return ZerodhaBroker(api_key=creds["api_key"], access_token=creds["access_token"])
    if broker_name == "upstox":
        from app.infra.brokers.upstox import UpstoxBroker

        return UpstoxBroker(api_key=creds["api_key"], access_token=creds["access_token"])
    if broker_name == "aliceblue":
        from app.infra.brokers.aliceblue import AliceBlueBroker

        return AliceBlueBroker(client_id=creds["client_id"], user_session=creds["user_session"])
    if broker_name == "dhan":
        from app.infra.brokers.dhan import DhanBroker

        return DhanBroker(client_id=creds["client_id"], access_token=creds["access_token"])
    return None


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
        broker = _reconstruct(json.loads(raw))
        if broker is None:
            return None
        _local_cache[user_id] = broker
        return broker
    except Exception:
        return None


async def set_broker(user_id: str, broker: AbstractBroker) -> None:
    _local_cache[user_id] = broker

    creds = broker.credentials
    if not creds:
        return  # simulated/other brokers carry no reconstructible credentials

    try:
        payload = json.dumps({"broker": broker.name, "credentials": creds})
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
