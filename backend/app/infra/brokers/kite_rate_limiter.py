"""Process-wide rate limiter for Kite Connect data calls (quotes,
historical candles, instrument dumps).

Kite enforces its own per-account rate limit (~3 req/s), but this app
runs many independent background jobs against the same one shared
Zerodha account (see settings.MARKET_DATA_BROKER_USER_ID) -- MCX NG
prediction, MCX Metals prediction, NG/Metals signal checks, candle
collection, plus live quote fetches for dashboards. Each job pacing
only its own call rate isn't enough: several politely-paced jobs
running in the same 5-minute window can still collectively exceed
Kite's real limit (confirmed in production -- see the scheduler.py
_MCX_METALS_PREDICTION_THROTTLE_SECONDS attempt this replaces, which
throttled that one job's own calls but left "Too many requests" errors
just as frequent, since other concurrent jobs' calls weren't accounted
for).

This module is the single chokepoint every Kite data call goes through
(ZerodhaBroker.get_raw_quote/get_historical_candles/get_instruments),
so the *combined* rate across the whole process -- no matter how many
jobs are calling concurrently -- stays under the limit.
"""

from __future__ import annotations

import asyncio
import time

# ~2.5 req/s combined across every Kite data call in the process --
# deliberately under Kite's documented ~3 req/s so there's margin for
# clock jitter and any other calls (order placement, positions) that
# don't go through this limiter.
_MIN_INTERVAL_SECONDS = 0.4

_lock = asyncio.Lock()
_next_allowed_at = 0.0


async def throttle() -> None:
    """Reserve the next available call slot on the shared timeline and
    sleep until it arrives. Safe under concurrency: the lock only
    protects the (cheap) slot reservation, not the actual API call, so
    callers don't serialize on each other's network round-trip -- they
    just can't fire closer together than _MIN_INTERVAL_SECONDS."""
    global _next_allowed_at
    async with _lock:
        now = time.monotonic()
        scheduled = max(now, _next_allowed_at)
        _next_allowed_at = scheduled + _MIN_INTERVAL_SECONDS
    wait = scheduled - now
    if wait > 0:
        await asyncio.sleep(wait)
