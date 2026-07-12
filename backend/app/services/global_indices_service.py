"""Global Indices data -- major world market benchmark indices (not
individual US stocks, see usa_stocks_service.py for that), via yfinance.

Reuses usa_stocks_service's generic fetch helpers (_fetch_quote_sync/
_fetch_klines_sync take any ticker string, not just US equities) and
crypto_service's Redis cache helpers, rather than duplicating either.

Fixed, curated list of ~28 major indices -- no UI add/remove like USA
Stocks' custom list (explicitly out of scope per user request; could be
added the same way later if needed).

Only ~28 tickers, so no dedicated scheduler prewarm job like USA Stocks/
Crypto have -- a cold fetch here is cheap enough (~28 concurrent yfinance
calls) to just pay on first request after each cache TTL expiry.

Every ticker below was live-validated against yfinance (both fast_info
quotes and 2y daily history) before being added. Explicitly NOT included,
because no working free Yahoo Finance ticker could be found after several
attempts each: TOPIX (only a JPY-denominated tracking ETF, "1306.T", was
found -- wrong scale/units to show as the index level itself) and the
Qatar Exchange, Abu Dhabi Securities Exchange, and Dubai Financial Market
indices (Gulf exchanges generally aren't covered by Yahoo Finance's free
tier at all; only Saudi Tadawul resolved, as "^TASI.SR").
"""

from __future__ import annotations

import asyncio

import structlog

from app.services.crypto_service import _cache_get_any, _cache_get_fresh, _cache_set, _local_lock
from app.services.usa_stocks_service import PERIODS, _fetch_klines_sync, _fetch_quote_sync

log = structlog.get_logger()

# display code -> {yfinance ticker, display name, region, group}. Yahoo
# Finance's own index ticker convention (^ prefix, mostly, with a few
# exchange-suffix exceptions like ".SS"/".SR"/".MI"). `region` is the
# specific country shown under each index's name; `group` is the broader
# America/Europe/Asia/India/Middle East/Other bucket the dashboard
# sections by -- kept separate since e.g. "Germany" and "France" are both
# `group` "Europe" but distinct `region` labels worth showing
# individually. India gets its own `group` (split out of "Asia") to match
# how it's referenced separately from the rest of Asia.
TRACKED_INDICES: dict[str, dict[str, str]] = {
    # America
    "DJI": {
        "ticker": "^DJI", "name": "Dow Jones Industrial Average", "region": "US", "group": "America"
    },
    "SPX": {"ticker": "^GSPC", "name": "S&P 500", "region": "US", "group": "America"},
    "NDX": {"ticker": "^NDX", "name": "Nasdaq 100", "region": "US", "group": "America"},
    "RUT": {"ticker": "^RUT", "name": "Russell 2000", "region": "US", "group": "America"},
    "VIX": {"ticker": "^VIX", "name": "VIX (Volatility Index)", "region": "US", "group": "America"},
    # Europe
    "FTSE": {"ticker": "^FTSE", "name": "FTSE 100", "region": "UK", "group": "Europe"},
    "GDAXI": {"ticker": "^GDAXI", "name": "DAX", "region": "Germany", "group": "Europe"},
    "FCHI": {"ticker": "^FCHI", "name": "CAC 40", "region": "France", "group": "Europe"},
    "STOXX50E": {
        "ticker": "^STOXX50E", "name": "Euro Stoxx 50", "region": "Europe", "group": "Europe"
    },
    "IBEX": {"ticker": "^IBEX", "name": "IBEX 35", "region": "Spain", "group": "Europe"},
    "FTSEMIB": {"ticker": "FTSEMIB.MI", "name": "FTSE MIB", "region": "Italy", "group": "Europe"},
    # Asia
    "N225": {"ticker": "^N225", "name": "Nikkei 225", "region": "Japan", "group": "Asia"},
    "HSI": {"ticker": "^HSI", "name": "Hang Seng", "region": "Hong Kong", "group": "Asia"},
    "SSEC": {
        "ticker": "000001.SS", "name": "Shanghai Composite", "region": "China", "group": "Asia"
    },
    "CSI300": {"ticker": "000300.SS", "name": "CSI 300", "region": "China", "group": "Asia"},
    "KS11": {"ticker": "^KS11", "name": "KOSPI", "region": "South Korea", "group": "Asia"},
    "TWII": {"ticker": "^TWII", "name": "Taiwan Weighted", "region": "Taiwan", "group": "Asia"},
    "STI": {"ticker": "^STI", "name": "Straits Times", "region": "Singapore", "group": "Asia"},
    # India (its own group, split out of Asia)
    "NSEI": {"ticker": "^NSEI", "name": "Nifty 50", "region": "India", "group": "India"},
    "NSEBANK": {"ticker": "^NSEBANK", "name": "Bank Nifty", "region": "India", "group": "India"},
    "BSESN": {"ticker": "^BSESN", "name": "Sensex", "region": "India", "group": "India"},
    "NSEMDCP50": {
        "ticker": "^NSEMDCP50", "name": "Nifty Midcap 50", "region": "India", "group": "India"
    },
    "FINNIFTY": {
        "ticker": "NIFTY_FIN_SERVICE.NS", "name": "Nifty Fin Service",
        "region": "India", "group": "India",
    },
    # Middle East -- Qatar/Abu Dhabi/Dubai have no working free Yahoo
    # Finance ticker (see module docstring); only Saudi Tadawul resolved.
    "TASI": {
        "ticker": "^TASI.SR", "name": "Tadawul All Share",
        "region": "Saudi Arabia", "group": "Middle East",
    },
    # Other
    "AXJO": {"ticker": "^AXJO", "name": "ASX 200", "region": "Australia", "group": "Other"},
    "NZ50": {"ticker": "^NZ50", "name": "NZX 50", "region": "New Zealand", "group": "Other"},
    "BVSP": {"ticker": "^BVSP", "name": "Bovespa", "region": "Brazil", "group": "Other"},
    "MXX": {"ticker": "^MXX", "name": "IPC Mexico", "region": "Mexico", "group": "Other"},
}

# region -> (open_minutes, close_minutes) local trading-day window --
# passed to usa_stocks_service._fetch_quote_sync/_market_status per index
# instead of that function's own NYSE-shaped default, since a single
# blanket window is wrong for most non-US markets (e.g. LSE opens
# ~08:00, Tokyo closes ~15:00, Taiwan closes ~13:30). Same caveats as
# _market_status's own docstring: approximate, no holiday calendar,
# real hours can vary ~30 min either side of these.
_MARKET_HOURS: dict[str, tuple[int, int]] = {
    "US": (9 * 60 + 30, 16 * 60),
    "UK": (8 * 60, 16 * 60 + 30),
    "Germany": (9 * 60, 17 * 60 + 30),
    "France": (9 * 60, 17 * 60 + 30),
    "Europe": (9 * 60, 17 * 60 + 30),
    "Spain": (9 * 60, 17 * 60 + 30),
    "Italy": (9 * 60, 17 * 60 + 30),
    "Japan": (9 * 60, 15 * 60),
    "Hong Kong": (9 * 60 + 30, 16 * 60),
    "China": (9 * 60 + 30, 15 * 60),
    "South Korea": (9 * 60, 15 * 60 + 30),
    "Taiwan": (9 * 60, 13 * 60 + 30),
    "Singapore": (9 * 60, 17 * 60),
    "India": (9 * 60 + 15, 15 * 60 + 30),
    "Saudi Arabia": (10 * 60, 15 * 60),
    "Australia": (10 * 60, 16 * 60),
    "New Zealand": (10 * 60, 16 * 60 + 45),
    "Brazil": (10 * 60, 17 * 60),
    "Mexico": (8 * 60 + 30, 15 * 60),
}
_DEFAULT_MARKET_HOURS = (9 * 60 + 15, 16 * 60)

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
                open_m, close_m = _MARKET_HOURS.get(info["region"], _DEFAULT_MARKET_HOURS)
                quote = await loop.run_in_executor(
                    None, _fetch_quote_sync, info["ticker"], open_m, close_m
                )
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
