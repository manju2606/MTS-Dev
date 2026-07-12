"""USA Stocks quotes + OHLC candles via yfinance -- same "quotes + real
timeframe chart + ranked prediction" structure as crypto_service.py /
binance_service.py, but one data source instead of two: unlike CoinGecko
(quotes) + Binance (candles) for Crypto, yfinance already gives both live
quotes and real intraday-to-monthly OHLC for US tickers directly, and is
already a dependency used elsewhere in this app (MCX correlation checks,
the equity ML predictor -- see app/infra/market_data/yfinance_client.py
for the existing India-specific version this mirrors, and
_normalise_symbol's ".NS" default in particular -- not reused here, since
appending ".NS" to a bare US ticker like "AAPL" would look up the wrong
market entirely).

yfinance calls are blocking (not native async) -- every call here runs
through loop.run_in_executor(), same as yfinance_client.py's own pattern.
mcx_ai_score_service._fetch_correlation_sync is a cautionary example of
NOT doing this (it calls yfinance directly inside an async function,
blocking the whole event loop for that request) -- not repeated here.

Prices are USD only, no INR conversion (US stocks have no natural INR
quote the way CoinGecko gave Crypto both currencies from one call) --
quote tiles/tables here are single-currency, unlike Crypto's.

Reuses crypto_service's Redis cache helpers (_local_lock/_cache_get_fresh/
_cache_get_any/_cache_set) since they're generic, not CoinGecko-specific
-- same cross-module reuse binance_service.py already does.
"""

from __future__ import annotations

import asyncio
import math

import structlog
import yfinance as yf

from app.services.crypto_service import _cache_get_any, _cache_get_fresh, _cache_set, _local_lock

log = structlog.get_logger()

# code -> yfinance ticker (identical for every entry here -- US tickers
# need no suffix, unlike yfinance_client.py's NSE/BSE ".NS"/".BO" ones).
# Top ~50 US stocks by market cap, a point-in-time snapshot (same "small
# fixed starter set, easy to extend" tradeoff as crypto_service's
# TRACKED_COINS) -- market-cap rankings shift over time, this isn't
# re-derived live.
TRACKED_STOCKS: dict[str, str] = {
    code: code
    for code in [
        "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B", "LLY", "AVGO",
        "JPM", "V", "UNH", "XOM", "MA", "JNJ", "PG", "HD", "COST", "MRK",
        "ABBV", "CVX", "CRM", "BAC", "PEP", "KO", "ADBE", "WMT", "NFLX", "AMD",
        "TMO", "MCD", "LIN", "CSCO", "ABT", "ACN", "ORCL", "DIS", "PM", "WFC",
        "DHR", "VZ", "TXN", "INTU", "AMGN", "CAT", "IBM", "GE", "NOW", "QCOM",
    ]
}

# Our period label -> (yfinance interval, lookback period, bucket seconds).
# yfinance caps how far back finer intervals go (1m: 7d max, 2m-90m: 60d
# max, 60m: 730d max) -- unlike Binance, which serves any interval over
# any history. No native 4h/8h here (yfinance doesn't offer them) --
# skipped rather than derived/merged, matching how 1m/5m/15m were simply
# not possible from CoinGecko's OHLC endpoint before the Crypto/Binance
# swap.
PERIODS: dict[str, tuple[str, str, int]] = {
    "1m": ("1m", "5d", 60),
    "5m": ("5m", "60d", 300),
    "15m": ("15m", "60d", 900),
    "30m": ("30m", "60d", 1800),
    "1h": ("60m", "730d", 3600),
    "1D": ("1d", "2y", 86400),
    "1W": ("1wk", "10y", 604800),
    "1M": ("1mo", "max", 2592000),
}

_REDIS_KEY_PREFIX = "usa_stocks:"


def _cache_ttl(bucket_seconds: int) -> int:
    """Shorter cache for finer periods, longer for coarser ones -- same
    reasoning as binance_service._cache_ttl."""
    return max(30, min(bucket_seconds // 4, 300))


def _safe_float(val: object, default: float = 0.0) -> float:
    if val is None:
        return default
    f = float(val)  # type: ignore[arg-type]
    return default if math.isnan(f) else f


def _fetch_quote_sync(ticker: str) -> dict:
    """Blocking -- must run via loop.run_in_executor. fast_info is one
    lightweight call (~15 min delayed, same tradeoff yfinance_client.py's
    own fallback path accepts) rather than the full 1-minute-intraday-
    first approach that file uses for NSE/BSE -- US large-caps don't need
    that extra precision for a heat-map tile."""
    t = yf.Ticker(ticker)
    fi = t.fast_info
    price = _safe_float(fi.last_price)
    if price == 0.0:
        raise ValueError(f"No market data available for '{ticker}'")
    prev_close = _safe_float(fi.previous_close, price)
    change = round(price - prev_close, 2)
    change_pct = round(change / prev_close * 100, 4) if prev_close else 0.0
    return {
        "code": ticker,
        "price": round(price, 2),
        "change": change,
        "change_pct": change_pct,
        "day_high": round(_safe_float(fi.day_high, price), 2),
        "day_low": round(_safe_float(fi.day_low, price), 2),
        "prev_close": round(prev_close, 2),
        "volume": int(_safe_float(fi.last_volume, 0.0)),
    }


def _fetch_klines_sync(ticker: str, interval: str, period: str) -> list[dict]:
    """Blocking -- must run via loop.run_in_executor."""
    hist = yf.Ticker(ticker).history(period=period, interval=interval, auto_adjust=True)
    if hist.empty:
        return []
    candles = []
    for ts, row in hist.iterrows():
        o, h, low_, c = row["Open"], row["High"], row["Low"], row["Close"]
        if any(math.isnan(v) for v in (o, h, low_, c)):
            continue
        candles.append(
            {
                "time": int(ts.timestamp()),
                "open": round(float(o), 2),
                "high": round(float(h), 2),
                "low": round(float(low_), 2),
                "close": round(float(c), 2),
                "volume": int(row["Volume"]) if not math.isnan(row["Volume"]) else 0,
            }
        )
    return candles


async def get_quotes() -> list[dict]:
    cache_key = f"{_REDIS_KEY_PREFIX}quotes"
    ttl = 30
    cached = await _cache_get_fresh(cache_key, ttl)
    if cached is not None:
        return cached

    async with _local_lock(cache_key):
        cached = await _cache_get_fresh(cache_key, ttl)
        if cached is not None:
            return cached

        loop = asyncio.get_running_loop()

        async def _safe_fetch(code: str, ticker: str) -> dict | None:
            try:
                return await loop.run_in_executor(None, _fetch_quote_sync, ticker)
            except Exception as exc:
                log.warning("usa_stocks.quote.skipped", code=code, error=str(exc))
                return None

        results = await asyncio.gather(
            *[_safe_fetch(code, ticker) for code, ticker in TRACKED_STOCKS.items()]
        )
        quotes = [q for q in results if q is not None]
        if quotes:
            await _cache_set(cache_key, quotes, ttl)
            return quotes

        stale = await _cache_get_any(cache_key)
        return stale if stale is not None else []


async def get_klines(code: str, period: str) -> list[dict]:
    ticker = TRACKED_STOCKS.get(code.upper())
    if ticker is None:
        raise ValueError(f"Unknown stock code '{code}' -- expected one of {list(TRACKED_STOCKS)}")
    interval_info = PERIODS.get(period)
    if interval_info is None:
        raise ValueError(f"Unknown period '{period}' -- expected one of {list(PERIODS)}")
    interval, lookback, bucket_seconds = interval_info
    ttl = _cache_ttl(bucket_seconds)

    cache_key = f"{_REDIS_KEY_PREFIX}ohlc:{ticker}:{period}"
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
                None, _fetch_klines_sync, ticker, interval, lookback
            )
        except Exception as exc:
            log.warning(
                "usa_stocks.klines.fetch_failed", ticker=ticker, period=period, error=str(exc)
            )
            stale = await _cache_get_any(cache_key)
            if stale is not None:
                return stale
            raise

        await _cache_set(cache_key, candles, ttl)
        return candles
