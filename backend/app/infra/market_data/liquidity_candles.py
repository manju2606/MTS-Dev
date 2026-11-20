"""OHLCV candles for the Liquidity Flow module, sourced from yfinance (the same
source the existing technical-indicator code uses). Results are cached in-process
for a few minutes to avoid hammering Yahoo on every page refresh."""

from __future__ import annotations

import asyncio
import time

import structlog
import yfinance as yf

from app.domain.services.liquidity_flow.engine import Candle

log = structlog.get_logger()

_PERIOD = {"1d": "1y", "1h": "60d"}
_TTL_SECONDS = 300
_cache: dict[tuple[str, str], tuple[float, list[Candle]]] = {}


def _fetch_sync(symbol: str, interval: str) -> list[Candle]:
    hist = yf.Ticker(symbol).history(
        period=_PERIOD[interval], interval=interval, auto_adjust=False
    )
    candles: list[Candle] = []
    for ts, row in hist.iterrows():
        vals = (row["Open"], row["High"], row["Low"], row["Close"])
        if any(v != v for v in vals):  # NaN check without importing numpy
            continue
        candles.append(Candle(
            time=int(ts.timestamp()),
            open=float(row["Open"]),
            high=float(row["High"]),
            low=float(row["Low"]),
            close=float(row["Close"]),
            volume=float(row["Volume"]) if row["Volume"] == row["Volume"] else 0.0,
        ))
    candles.sort(key=lambda c: c.time)
    return candles


async def fetch_candles(symbol: str, interval: str) -> list[Candle]:
    if interval not in _PERIOD:
        raise ValueError(f"Unsupported interval: {interval}")
    key = (symbol, interval)
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < _TTL_SECONDS:
        return cached[1]
    candles = await asyncio.to_thread(_fetch_sync, symbol, interval)
    log.info("liquidity_flow.candles_fetched", symbol=symbol, interval=interval, count=len(candles))
    if candles:
        _cache[key] = (time.monotonic(), candles)
    return candles
