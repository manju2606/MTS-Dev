"""Crypto quotes (+ USD price) via CoinGecko's public API -- no broker
session needed (unlike MCX/Zerodha), since this is public, non-personalized
market data with no per-user auth. OHLC candles for the chart come from
Binance instead (see binance_service.py) -- CoinGecko's free OHLC endpoint
tops out at 30-minute granularity with no native 1m/5m/15m/1D/1W/1M
candles, so it's kept here only for quotes/heat-map prices and the
now-unused-by-the-chart get_history() price-point series.

CoinGecko's free public API is rate-limited per source IP, shared across
every user of this app since calls come from this one server -- confirmed
live (a single request stayed 429'd for several minutes after a 21-call
burst). Caching AND the rate-limit pacing gate both live in Redis, not an
in-process dict/asyncio.Lock: this app runs `--workers 2` (confirmed via
/proc, despite the Dockerfile CMD reading `--workers 1` at a glance --
worth re-checking if this ever looks stale again), and each worker is a
separate process with its own memory, so an in-process-only lock would
only serialize calls *within* one worker -- the other worker could fire
its own call at the same moment, silently allowing ~2x the intended rate.
mcx_service.py already hit this exact class of bug for its own quote
cache (see that module's docstring on why it uses Redis, not
_INSTRUMENTS_CACHE's in-process dict, for anything that needs to be
consistent across workers). binance_service.py reuses the cache helpers
below (_local_lock/_cache_get_fresh/_cache_get_any/_cache_set) since
they're generic, not CoinGecko-specific.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import TYPE_CHECKING

import httpx
import structlog

from app.core.config import settings

if TYPE_CHECKING:
    import redis.asyncio

log = structlog.get_logger()

_COINGECKO_BASE = "https://api.coingecko.com/api/v3"
_HTTP_TIMEOUT = 10.0

# code -> CoinGecko coin id. A small, fixed starter set (top coins by
# market cap) -- easy to extend later, no reason to support arbitrary
# coins until there's a real need for it.
TRACKED_COINS: dict[str, str] = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "BNB": "binancecoin",
    "SOL": "solana",
    "XRP": "ripple",
    "ADA": "cardano",
    "DOGE": "dogecoin",
}

_QUOTES_TTL = 30
_HISTORY_TTL = 60

_REDIS_PREFIX = "crypto:"

# CoinGecko's public-tier rate limit is on call *rate* (calls/minute), not
# concurrent connections -- a bare concurrency cap (asyncio.Semaphore) was
# tried first and still tripped 429s under a full cold-cache burst. 4s
# (15 calls/min) is deliberately conservative: 1.5s (40/min) was tried
# first and still got rate-limited. A full cold-start ranked table takes
# ~85s worst case at 4s spacing, but the prewarm job pays that cost in the
# background, not a real request.
_COINGECKO_MIN_INTERVAL = 4.0

# In-process locks: these do NOT replace the Redis-based cross-worker
# protection below, they only avoid redundant Redis round-trips when many
# concurrent requests land on the *same* worker for the same cache key.
_local_locks: dict[str, asyncio.Lock] = {}


def _local_lock(key: str) -> asyncio.Lock:
    if key not in _local_locks:
        _local_locks[key] = asyncio.Lock()
    return _local_locks[key]


def _redis() -> redis.asyncio.Redis:
    import redis.asyncio as aioredis

    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


# Cached entries carry their own {ts, data} rather than relying solely on
# Redis' TTL for freshness -- the Redis key is kept alive well past `ttl`
# (STALE_MULTIPLIER x longer) specifically so a CoinGecko failure can still
# serve the last good value (see get_quotes'/get_ohlc's except branches)
# instead of erroring, same fallback philosophy as mcx_service.get_quote's
# stale-cache fallback. A pure Redis EX-based cache would have nothing
# left to return once the TTL passes -- expired keys are just gone.
_STALE_MULTIPLIER = 12


# Every cache key here holds a JSON *array* payload (quotes/history/OHLC
# are all lists of dicts) -- /simple/price's dict-shaped response
# (_fetch_usd_prices) is used transiently and never goes through these.
CachePayload = list[dict]


async def _cache_get_fresh(key: str, ttl: int) -> CachePayload | None:
    """Only returns the cached value if it's within `ttl`; None otherwise
    (whether that's a true cache miss or the entry has gone stale) --
    callers treat both cases the same: go fetch a new one."""
    try:
        r = _redis()
        raw = await r.get(f"{_REDIS_PREFIX}{key}")
        await r.aclose()
        if not raw:
            return None
        entry = json.loads(raw)
        if (time.time() - entry["ts"]) < ttl:
            return entry["data"]
        return None
    except Exception as exc:
        log.warning("crypto.cache.read_failed", key=key, error=str(exc))
        return None


async def _cache_get_any(key: str) -> CachePayload | None:
    """Returns whatever's cached regardless of freshness -- the fallback
    path when a live refetch has just failed."""
    try:
        r = _redis()
        raw = await r.get(f"{_REDIS_PREFIX}{key}")
        await r.aclose()
        return json.loads(raw)["data"] if raw else None
    except Exception as exc:
        log.warning("crypto.cache.read_failed", key=key, error=str(exc))
        return None


async def _cache_set(key: str, value: CachePayload, ttl: int) -> None:
    try:
        r = _redis()
        entry = {"ts": time.time(), "data": value}
        await r.set(f"{_REDIS_PREFIX}{key}", json.dumps(entry), ex=ttl * _STALE_MULTIPLIER)
        await r.aclose()
    except Exception as exc:
        log.warning("crypto.cache.write_failed", key=key, error=str(exc))


async def _cache_delete(key: str) -> None:
    """Invalidates a cache entry outright, rather than waiting for its TTL
    -- used when a write elsewhere (e.g. usa_stocks_service.add_custom_stock)
    makes the cached value stale immediately, instead of up to `ttl`
    seconds later."""
    try:
        r = _redis()
        await r.delete(f"{_REDIS_PREFIX}{key}")
        await r.aclose()
    except Exception as exc:
        log.warning("crypto.cache.delete_failed", key=key, error=str(exc))


async def _coingecko_pace() -> None:
    """Blocks (if needed) until it's safe to make another CoinGecko call,
    enforced via Redis so the wait applies across both worker processes,
    not just the calling one -- see this module's own docstring."""
    lock_key = f"{_REDIS_PREFIX}coingecko:lock"
    last_call_key = f"{_REDIS_PREFIX}coingecko:last_call"
    r = _redis()
    try:
        for _ in range(100):  # ~10s worst-case spin if heavily contended
            if await r.set(lock_key, "1", nx=True, px=5000):
                break
            await asyncio.sleep(0.1)
        try:
            last_call_raw = await r.get(last_call_key)
            last_call = float(last_call_raw) if last_call_raw else 0.0
            wait = last_call + _COINGECKO_MIN_INTERVAL - time.time()
            if wait > 0:
                await asyncio.sleep(wait)
            await r.set(last_call_key, str(time.time()), ex=60)
        finally:
            await r.delete(lock_key)
    except Exception as exc:
        # Redis being briefly unavailable shouldn't block crypto quotes
        # entirely -- fail open (no pacing that one call) rather than
        # raising, same fallback philosophy as mcx_service's quote cache.
        log.warning("crypto.coingecko_pace.failed", error=str(exc))
    finally:
        await r.aclose()


async def _coingecko_request(path: str, params: dict) -> dict | list:
    await _coingecko_pace()
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.get(f"{_COINGECKO_BASE}{path}", params=params)
        resp.raise_for_status()
        return resp.json()


async def _coingecko_get_list(path: str, params: dict) -> list:
    """/coins/markets returns a list of per-coin dicts; /coins/{id}/ohlc
    returns a list of [time, open, high, low, close] lists -- two
    different element shapes, hence the bare `list` rather than
    overclaiming `list[dict]`. A thin, properly-typed wrapper either way,
    instead of every caller having to narrow _coingecko_request's
    dict|list union itself."""
    data = await _coingecko_request(path, params)
    assert isinstance(data, list)
    return data


async def _coingecko_get_dict(path: str, params: dict) -> dict:
    """/simple/price returns a JSON object (coingecko_id -> currency ->
    price), unlike every other endpoint this module calls."""
    data = await _coingecko_request(path, params)
    assert isinstance(data, dict)
    return data


async def _fetch_usd_prices() -> dict[str, float]:
    """coingecko_id -> USD price, via /simple/price (one call, both
    currencies aren't available from /coins/markets which only takes a
    single vs_currency) -- best-effort, callers fall back to null on
    failure rather than losing the whole quotes response over it."""
    try:
        data = await _coingecko_get_dict(
            "/simple/price",
            {"ids": ",".join(TRACKED_COINS.values()), "vs_currencies": "usd"},
        )
        return {coingecko_id: d["usd"] for coingecko_id, d in data.items() if "usd" in d}
    except Exception as exc:
        log.warning("crypto.quotes.usd_fetch_failed", error=str(exc))
        return {}


async def get_quotes(vs_currency: str = "inr") -> list[dict]:
    cached = await _cache_get_fresh("quotes", _QUOTES_TTL)
    if cached is not None:
        return cached

    async with _local_lock("quotes"):
        cached = await _cache_get_fresh("quotes", _QUOTES_TTL)
        if cached is not None:
            return cached
        try:
            data = await _coingecko_get_list(
                "/coins/markets",
                {"vs_currency": vs_currency, "ids": ",".join(TRACKED_COINS.values())},
            )
        except Exception as exc:
            log.warning("crypto.quotes.fetch_failed", error=str(exc))
            stale = await _cache_get_any("quotes")
            if stale is not None:
                return stale
            raise

        usd_prices = await _fetch_usd_prices()
        by_id = {d["id"]: d for d in data}
        quotes = []
        for code, coingecko_id in TRACKED_COINS.items():
            d = by_id.get(coingecko_id)
            if not d:
                continue
            quotes.append(
                {
                    "code": code,
                    "name": d["name"],
                    "image": d.get("image"),
                    "price": d["current_price"],
                    "price_usd": usd_prices.get(coingecko_id),
                    "change_24h": d.get("price_change_24h"),
                    "change_pct_24h": d.get("price_change_percentage_24h"),
                    "high_24h": d.get("high_24h"),
                    "low_24h": d.get("low_24h"),
                    "market_cap": d.get("market_cap"),
                    "market_cap_rank": d.get("market_cap_rank"),
                    "volume_24h": d.get("total_volume"),
                    "last_updated": d.get("last_updated"),
                }
            )
        await _cache_set("quotes", quotes, _QUOTES_TTL)
        return quotes


async def get_history(coin: str, days: str = "1") -> list[dict]:
    coingecko_id = TRACKED_COINS.get(coin.upper())
    if coingecko_id is None:
        raise ValueError(f"Unknown crypto code '{coin}' -- expected one of {list(TRACKED_COINS)}")

    cache_key = f"history:{coingecko_id}:{days}"
    cached = await _cache_get_fresh(cache_key, _HISTORY_TTL)
    if cached is not None:
        return cached

    async with _local_lock(cache_key):
        cached = await _cache_get_fresh(cache_key, _HISTORY_TTL)
        if cached is not None:
            return cached
        try:
            data = await _coingecko_get_dict(
                f"/coins/{coingecko_id}/market_chart", {"vs_currency": "inr", "days": days}
            )
        except Exception:
            stale = await _cache_get_any(cache_key)
            if stale is not None:
                return stale
            raise

        points = [
            {"time": int(t / 1000), "price": round(p, 2)} for t, p in data.get("prices", [])
        ]
        await _cache_set(cache_key, points, _HISTORY_TTL)
        return points


