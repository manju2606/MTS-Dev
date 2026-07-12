"""Crypto OHLC candles via Binance's public klines API -- swapped in for
the chart specifically because CoinGecko's free OHLC endpoint tops out at
30-minute granularity with no native 1m/5m/15m/1h/1D/1W/1M candles (see
crypto_service.py's own docstring on that limit, confirmed live). Binance
needs no API key for market data and allows roughly 1200 weight/min
(klines cost ~2 weight each, so ~500-600 calls/min) -- dramatically more
headroom than CoinGecko's public tier, which was confirmed getting
rate-limited for several minutes after a mere 21-call burst.

Prices here are in USDT (Binance has no direct INR market for these
coins), not INR -- this module is chart-candles-only. Quotes/heat-map
prices (both ₹ and $) still come from crypto_service.py's CoinGecko
quotes; only the chart's OHLC source changed.

Reuses crypto_service's Redis cache helpers (_local_lock/_cache_get_fresh/
_cache_get_any/_cache_set) since they're generic, not CoinGecko-specific
-- same cross-module reuse pattern mcx_metals_*.py already uses against
mcx_*.py's private helpers.
"""

from __future__ import annotations

import httpx
import structlog

from app.services.crypto_service import _cache_get_any, _cache_get_fresh, _cache_set, _local_lock

log = structlog.get_logger()

_BINANCE_BASE = "https://api.binance.com/api/v3"
_HTTP_TIMEOUT = 10.0

# code -> Binance trading pair, all against USDT (Binance has no direct
# INR market for these coins).
BINANCE_SYMBOLS: dict[str, str] = {
    "BTC": "BTCUSDT",
    "ETH": "ETHUSDT",
    "BNB": "BNBUSDT",
    "SOL": "SOLUSDT",
    "XRP": "XRPUSDT",
    "ADA": "ADAUSDT",
    "DOGE": "DOGEUSDT",
}

# Our period label -> (Binance interval string, bucket width in seconds).
# All native Binance kline intervals -- no resampling/merging needed,
# unlike crypto_service.py's old CoinGecko-based 1h/8h (those had to be
# derived by merging 30m/4h candles because CoinGecko has no native 1h/8h
# tier; Binance has both directly, plus genuine 1m/5m/15m/1D/1W/1M that
# CoinGecko's OHLC endpoint can't provide at all).
PERIODS: dict[str, tuple[str, int]] = {
    "1m": ("1m", 60),
    "5m": ("5m", 300),
    "15m": ("15m", 900),
    "30m": ("30m", 1800),
    "1h": ("1h", 3600),
    "4h": ("4h", 14400),
    "8h": ("8h", 28800),
    "1D": ("1d", 86400),
    "1W": ("1w", 604800),
    "1M": ("1M", 2592000),  # approximate (30d) -- real months vary; only
    # used for our own prediction-bucket math, not the raw kline fetch.
}

_REDIS_KEY_PREFIX = "binance:klines:"


def _cache_ttl(bucket_seconds: int) -> int:
    """Shorter cache for finer periods (a 1-min chart should look
    reasonably live), longer for coarser ones that can't meaningfully
    change within a short window anyway. Binance's generous rate limit
    means this is about freshness, not survival, unlike CoinGecko's
    _OHLC_TTL which was sized around not tripping a 429."""
    return max(15, min(bucket_seconds // 4, 300))


async def get_klines(coin: str, period: str, limit: int = 500) -> list[dict]:
    """OHLC candles for `period`, {time, open, high, low, close, volume}
    -- unlike crypto_service's old CoinGecko-based candles, Binance's
    klines endpoint does include real volume."""
    symbol = BINANCE_SYMBOLS.get(coin.upper())
    if symbol is None:
        raise ValueError(f"Unknown crypto code '{coin}' -- expected one of {list(BINANCE_SYMBOLS)}")
    interval_info = PERIODS.get(period)
    if interval_info is None:
        raise ValueError(f"Unknown period '{period}' -- expected one of {list(PERIODS)}")
    interval, bucket_seconds = interval_info
    ttl = _cache_ttl(bucket_seconds)

    cache_key = f"{_REDIS_KEY_PREFIX}{symbol}:{period}"
    cached = await _cache_get_fresh(cache_key, ttl)
    if cached is not None:
        return cached

    async with _local_lock(cache_key):
        cached = await _cache_get_fresh(cache_key, ttl)
        if cached is not None:
            return cached
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                resp = await client.get(
                    f"{_BINANCE_BASE}/klines",
                    params={"symbol": symbol, "interval": interval, "limit": limit},
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            log.warning(
                "crypto.binance.fetch_failed", symbol=symbol, period=period, error=str(exc)
            )
            stale = await _cache_get_any(cache_key)
            if stale is not None:
                return stale
            raise

        candles = [
            {
                "time": int(row[0] / 1000),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]),
            }
            for row in data
        ]
        await _cache_set(cache_key, candles, ttl)
        return candles
