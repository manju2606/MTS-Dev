"""Crypto quotes + price history via CoinGecko's public API -- no broker
session needed (unlike MCX/Zerodha), since this is public, non-personalized
market data with no per-user auth. v1 scope: live quotes + a basic price
chart only, no AI score/predictions/signals/paper-trading yet (see MCX for
that fuller pattern, once/if this gets extended the same way).

CoinGecko's free public API is rate-limited (shared across every user of
this app, since calls come from this one server) -- both endpoints below
cache with the same double-checked-locking pattern used for
mcx_service._get_mcx_instruments, so concurrent requests on a cold/expired
cache share one upstream call instead of each re-fetching independently.
"""

from __future__ import annotations

import asyncio
import time

import httpx
import structlog

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

_QUOTES_TTL = 30.0
_QUOTES_CACHE: tuple[float, list[dict]] | None = None
_QUOTES_LOCK = asyncio.Lock()

_HISTORY_TTL = 60.0
_HISTORY_CACHE: dict[str, tuple[float, list[dict]]] = {}
_HISTORY_LOCK = asyncio.Lock()


async def get_quotes(vs_currency: str = "inr") -> list[dict]:
    global _QUOTES_CACHE
    now = time.monotonic()
    if _QUOTES_CACHE and (now - _QUOTES_CACHE[0]) < _QUOTES_TTL:
        return _QUOTES_CACHE[1]

    async with _QUOTES_LOCK:
        if _QUOTES_CACHE and (time.monotonic() - _QUOTES_CACHE[0]) < _QUOTES_TTL:
            return _QUOTES_CACHE[1]
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                resp = await client.get(
                    f"{_COINGECKO_BASE}/coins/markets",
                    params={
                        "vs_currency": vs_currency,
                        "ids": ",".join(TRACKED_COINS.values()),
                    },
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            log.warning("crypto.quotes.fetch_failed", error=str(exc))
            if _QUOTES_CACHE:
                return _QUOTES_CACHE[1]
            raise

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
        _QUOTES_CACHE = (time.monotonic(), quotes)
        return quotes


async def get_history(coin: str, days: str = "1") -> list[dict]:
    coingecko_id = TRACKED_COINS.get(coin.upper())
    if coingecko_id is None:
        raise ValueError(f"Unknown crypto code '{coin}' -- expected one of {list(TRACKED_COINS)}")

    cache_key = f"{coingecko_id}:{days}"
    now = time.monotonic()
    cached = _HISTORY_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _HISTORY_TTL:
        return cached[1]

    async with _HISTORY_LOCK:
        cached = _HISTORY_CACHE.get(cache_key)
        if cached and (time.monotonic() - cached[0]) < _HISTORY_TTL:
            return cached[1]
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(
                f"{_COINGECKO_BASE}/coins/{coingecko_id}/market_chart",
                params={"vs_currency": "inr", "days": days},
            )
            resp.raise_for_status()
            data = resp.json()

        points = [
            {"time": int(t / 1000), "price": round(p, 2)} for t, p in data.get("prices", [])
        ]
        _HISTORY_CACHE[cache_key] = (time.monotonic(), points)
        return points
