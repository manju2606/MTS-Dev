"""Global Indices data -- major world market benchmark indices (not
individual US stocks, see usa_stocks_service.py for that), via yfinance.

Reuses usa_stocks_service's generic fetch helpers (_fetch_quote_sync/
_fetch_klines_sync take any ticker string, not just US equities) and
crypto_service's Redis cache helpers, rather than duplicating either.

Fixed, curated list of ~15 major indices -- no UI add/remove like USA
Stocks' custom list (explicitly out of scope per user request; could be
added the same way later if needed).

Only 15 tickers, so no dedicated scheduler prewarm job like USA Stocks/
Crypto have -- a cold fetch here is cheap enough (~15 concurrent yfinance
calls) to just pay on first request after each cache TTL expiry.
"""

from __future__ import annotations

import asyncio

import structlog

from app.services.crypto_service import _cache_get_any, _cache_get_fresh, _cache_set, _local_lock
from app.services.usa_stocks_service import PERIODS, _fetch_klines_sync, _fetch_quote_sync

log = structlog.get_logger()

# display code -> {yfinance ticker, display name, region}. Yahoo Finance's
# own index ticker convention (^ prefix, except Shanghai Composite which
# uses the .SS suffix form).
TRACKED_INDICES: dict[str, dict[str, str]] = {
    "SPX": {"ticker": "^GSPC", "name": "S&P 500", "region": "US"},
    "IXIC": {"ticker": "^IXIC", "name": "Nasdaq Composite", "region": "US"},
    "DJI": {"ticker": "^DJI", "name": "Dow Jones Industrial Average", "region": "US"},
    "RUT": {"ticker": "^RUT", "name": "Russell 2000", "region": "US"},
    "FTSE": {"ticker": "^FTSE", "name": "FTSE 100", "region": "UK"},
    "GDAXI": {"ticker": "^GDAXI", "name": "DAX", "region": "Germany"},
    "FCHI": {"ticker": "^FCHI", "name": "CAC 40", "region": "France"},
    "STOXX50E": {"ticker": "^STOXX50E", "name": "Euro Stoxx 50", "region": "Europe"},
    "N225": {"ticker": "^N225", "name": "Nikkei 225", "region": "Japan"},
    "HSI": {"ticker": "^HSI", "name": "Hang Seng", "region": "Hong Kong"},
    "SSEC": {"ticker": "000001.SS", "name": "Shanghai Composite", "region": "China"},
    "KS11": {"ticker": "^KS11", "name": "KOSPI", "region": "South Korea"},
    "BSESN": {"ticker": "^BSESN", "name": "Sensex", "region": "India"},
    "NSEI": {"ticker": "^NSEI", "name": "Nifty 50", "region": "India"},
    "AXJO": {"ticker": "^AXJO", "name": "ASX 200", "region": "Australia"},
}

_REDIS_KEY_PREFIX = "global_indices:"
_QUOTES_TTL = 30
TREND_PERIOD = "1D"


async def get_quotes() -> list[dict]:
    cache_key = f"{_REDIS_KEY_PREFIX}quotes"
    cached = await _cache_get_fresh(cache_key, _QUOTES_TTL)
    if cached is not None:
        return cached

    async with _local_lock(cache_key):
        cached = await _cache_get_fresh(cache_key, _QUOTES_TTL)
        if cached is not None:
            return cached

        loop = asyncio.get_running_loop()

        async def _safe_fetch(code: str, info: dict[str, str]) -> dict | None:
            try:
                quote = await loop.run_in_executor(None, _fetch_quote_sync, info["ticker"])
                quote["code"] = code
                quote["name"] = info["name"]
                quote["region"] = info["region"]
                return quote
            except Exception as exc:
                log.warning("global_indices.quote.skipped", code=code, error=str(exc))
                return None

        results = await asyncio.gather(
            *[_safe_fetch(code, info) for code, info in TRACKED_INDICES.items()]
        )
        quotes = [q for q in results if q is not None]
        if quotes:
            await _cache_set(cache_key, quotes, _QUOTES_TTL)
            return quotes

        stale = await _cache_get_any(cache_key)
        return stale if stale is not None else []


async def get_klines(code: str, period: str = TREND_PERIOD) -> list[dict]:
    info = TRACKED_INDICES.get(code.upper())
    if info is None:
        raise ValueError(f"Unknown index code '{code}' -- expected one of {list(TRACKED_INDICES)}")
    interval_info = PERIODS.get(period)
    if interval_info is None:
        raise ValueError(f"Unknown period '{period}' -- expected one of {list(PERIODS)}")
    interval, lookback, bucket_seconds = interval_info
    ttl = max(30, min(bucket_seconds // 4, 300))

    cache_key = f"{_REDIS_KEY_PREFIX}ohlc:{info['ticker']}:{period}"
    cached = await _cache_get_fresh(cache_key, ttl)
    if cached is not None:
        return cached

    async with _local_lock(cache_key):
        cached = await _cache_get_fresh(cache_key, ttl)
        if cached is not None:
            return cached
        loop = asyncio.get_running_loop()
        try:
            candles = await loop.run_in_executor(
                None, _fetch_klines_sync, info["ticker"], interval, lookback
            )
        except Exception as exc:
            log.warning(
                "global_indices.klines.fetch_failed",
                ticker=info["ticker"],
                period=period,
                error=str(exc),
            )
            stale = await _cache_get_any(cache_key)
            if stale is not None:
                return stale
            raise

        await _cache_set(cache_key, candles, ttl)
        return candles
