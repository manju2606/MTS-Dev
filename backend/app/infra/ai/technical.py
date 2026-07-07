"""Compute technical indicators from yfinance price history."""

import asyncio
import math
from dataclasses import dataclass

import yfinance as yf


@dataclass
class TechnicalIndicators:
    symbol: str
    sma_20: float
    sma_50: float | None  # None if < 50 data points
    rsi_14: float
    macd: float
    macd_signal: float
    bb_upper: float
    bb_lower: float
    atr_14: float
    volume_ratio: float  # latest / 20-day avg
    price_vs_sma20_pct: float  # % above(+)/below(-) SMA-20
    trend: str  # "uptrend" | "downtrend" | "sideways"


def _ema_series(values: list[float], period: int) -> list[float]:
    k = 2.0 / (period + 1)
    result = [values[0]]
    for v in values[1:]:
        result.append(v * k + result[-1] * (1.0 - k))
    return result


def _rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(0.0, c) for c in changes]
    losses = [max(0.0, -c) for c in changes]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    return round(100 - 100 / (1 + avg_gain / avg_loss), 2)


def _atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float:
    trs = [highs[0] - lows[0]]
    for i in range(1, len(highs)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    return round(sum(trs[-period:]) / min(period, len(trs)), 2)


def _fetch_sync(symbol: str) -> TechnicalIndicators:
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="3mo")
    if hist.empty or len(hist) < 21:
        raise ValueError(f"Insufficient history for '{symbol}'")

    closes = [float(v) for v in hist["Close"].tolist()]
    highs = [float(v) for v in hist["High"].tolist()]
    lows = [float(v) for v in hist["Low"].tolist()]
    volumes = [float(v) for v in hist["Volume"].tolist()]

    n = len(closes)
    sma_20 = sum(closes[-20:]) / 20
    sma_50 = sum(closes[-50:]) / 50 if n >= 50 else None

    rsi = _rsi(closes)

    ema12 = _ema_series(closes, 12)
    ema26 = _ema_series(closes, 26)
    macd_vals = [ema12[i] - ema26[i] for i in range(n)]
    macd_line = macd_vals[-1]
    macd_sig = _ema_series(macd_vals, 9)[-1]

    std20 = math.sqrt(sum((c - sma_20) ** 2 for c in closes[-20:]) / 20)
    bb_upper = round(sma_20 + 2 * std20, 2)
    bb_lower = round(sma_20 - 2 * std20, 2)

    atr = _atr(highs, lows, closes)

    avg_vol = sum(volumes[-20:]) / 20
    vol_ratio = round(volumes[-1] / avg_vol, 2) if avg_vol > 0 else 1.0

    price = closes[-1]
    price_vs_sma20 = round((price - sma_20) / sma_20 * 100, 2)

    if sma_50 and sma_20 > sma_50 and price > sma_20:
        trend = "uptrend"
    elif sma_50 and sma_20 < sma_50 and price < sma_20:
        trend = "downtrend"
    else:
        trend = "sideways"

    return TechnicalIndicators(
        symbol=symbol,
        sma_20=round(sma_20, 2),
        sma_50=round(sma_50, 2) if sma_50 else None,
        rsi_14=rsi,
        macd=round(macd_line, 4),
        macd_signal=round(macd_sig, 4),
        bb_upper=bb_upper,
        bb_lower=bb_lower,
        atr_14=atr,
        volume_ratio=vol_ratio,
        price_vs_sma20_pct=price_vs_sma20,
        trend=trend,
    )


async def fetch_indicators(symbol: str) -> TechnicalIndicators:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _fetch_sync, symbol)
