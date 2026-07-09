"""Technical indicator math for the MCX Natural Gas AI score (NG-AI Pro v1).

Pure functions over OHLCV(+OI) candle dicts (Kite's historical_data shape:
{date, open, high, low, close, volume, oi}, oldest first). No external TA
library -- plain list/float math, consistent with app/infra/ai/technical.py's
approach elsewhere in this codebase.
"""

from __future__ import annotations

Candle = dict


def closes(candles: list[Candle]) -> list[float]:
    return [float(c["close"]) for c in candles]


def highs(candles: list[Candle]) -> list[float]:
    return [float(c["high"]) for c in candles]


def lows(candles: list[Candle]) -> list[float]:
    return [float(c["low"]) for c in candles]


def volumes(candles: list[Candle]) -> list[float]:
    return [float(c["volume"]) for c in candles]


def open_interests(candles: list[Candle]) -> list[float]:
    return [float(c.get("oi", 0) or 0) for c in candles]


# ── Moving averages / trend ──────────────────────────────────────────────────


def ema_series(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2 / (period + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def ema(values: list[float], period: int) -> float | None:
    series = ema_series(values, period)
    return series[-1] if len(values) >= period else None


# ── Momentum ──────────────────────────────────────────────────────────────────


def rsi(values: list[float], period: int = 14) -> float | None:
    if len(values) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(values)):
        change = values[i] - values[i - 1]
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def macd(
    values: list[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[float, float, float] | None:
    """Returns (macd_line, signal_line, histogram)."""
    if len(values) < slow + signal:
        return None
    fast_series = ema_series(values, fast)
    slow_series = ema_series(values, slow)
    macd_line_series = [f - s for f, s in zip(fast_series, slow_series, strict=True)]
    signal_series = ema_series(macd_line_series, signal)
    macd_line = macd_line_series[-1]
    signal_line = signal_series[-1]
    return round(macd_line, 4), round(signal_line, 4), round(macd_line - signal_line, 4)


def stochastic(
    h: list[float], low: list[float], c: list[float], period: int = 14, smooth: int = 3
) -> tuple[float, float] | None:
    """Returns (%K, %D)."""
    if len(c) < period + smooth:
        return None
    k_values = []
    for i in range(period - 1, len(c)):
        window_high = max(h[i - period + 1 : i + 1])
        window_low = min(low[i - period + 1 : i + 1])
        if window_high == window_low:
            k_values.append(50.0)
        else:
            k_values.append((c[i] - window_low) / (window_high - window_low) * 100)
    if len(k_values) < smooth:
        return None
    percent_k = sum(k_values[-smooth:]) / smooth
    d_values = k_values[-smooth * 2 :] if len(k_values) >= smooth * 2 else k_values
    percent_d = sum(d_values[-smooth:]) / smooth
    return round(percent_k, 2), round(percent_d, 2)


def roc(values: list[float], period: int = 10) -> float | None:
    if len(values) < period + 1:
        return None
    prior = values[-period - 1]
    return round((values[-1] - prior) / prior * 100, 2) if prior else None


# ── Volatility ────────────────────────────────────────────────────────────────


def true_range_series(h: list[float], low: list[float], c: list[float]) -> list[float]:
    trs = [h[0] - low[0]]
    for i in range(1, len(c)):
        trs.append(max(h[i] - low[i], abs(h[i] - c[i - 1]), abs(low[i] - c[i - 1])))
    return trs


def atr(h: list[float], low: list[float], c: list[float], period: int = 14) -> float | None:
    if len(c) < period + 1:
        return None
    trs = true_range_series(h, low, c)
    return round(sum(trs[-period:]) / period, 4)


def atr_series(h: list[float], low: list[float], c: list[float], period: int = 14) -> list[float]:
    trs = true_range_series(h, low, c)
    return ema_series(trs, period)


def bollinger(
    values: list[float], period: int = 20, mult: float = 2.0
) -> tuple[float, float, float] | None:
    """Returns (upper, mid, lower)."""
    if len(values) < period:
        return None
    window = values[-period:]
    mid = sum(window) / period
    variance = sum((v - mid) ** 2 for v in window) / period
    std = variance**0.5
    return round(mid + mult * std, 4), round(mid, 4), round(mid - mult * std, 4)


def adx(h: list[float], low: list[float], c: list[float], period: int = 14) -> float | None:
    if len(c) < period * 2:
        return None
    plus_dm, minus_dm = [], []
    for i in range(1, len(c)):
        up = h[i] - h[i - 1]
        down = low[i - 1] - low[i]
        plus_dm.append(up if (up > down and up > 0) else 0.0)
        minus_dm.append(down if (down > up and down > 0) else 0.0)
    trs = true_range_series(h, low, c)[1:]
    atr_s = ema_series(trs, period)
    plus_di_s = [
        100 * p / a if a else 0.0 for p, a in zip(ema_series(plus_dm, period), atr_s, strict=True)
    ]
    minus_di_s = [
        100 * m / a if a else 0.0 for m, a in zip(ema_series(minus_dm, period), atr_s, strict=True)
    ]
    dx_s = [
        100 * abs(p - m) / (p + m) if (p + m) else 0.0
        for p, m in zip(plus_di_s, minus_di_s, strict=True)
    ]
    adx_s = ema_series(dx_s, period)
    return round(adx_s[-1], 2) if adx_s else None


def choppiness_index(
    h: list[float], low: list[float], c: list[float], period: int = 14
) -> float | None:
    if len(c) < period + 1:
        return None
    trs = true_range_series(h, low, c)
    atr_sum = sum(trs[-period:])
    window_high = max(h[-period:])
    window_low = min(low[-period:])
    rng = window_high - window_low
    if rng == 0 or atr_sum == 0:
        return None
    import math

    return round(100 * math.log10(atr_sum / rng) / math.log10(period), 2)


def keltner(
    h: list[float], low: list[float], c: list[float], period: int = 20, mult: float = 2.0
) -> tuple[float, float, float] | None:
    """Returns (upper, mid, lower) -- EMA midline +/- ATR multiple."""
    if len(c) < period:
        return None
    mid = ema(c, period)
    band = atr(h, low, c, period)
    if mid is None or band is None:
        return None
    return round(mid + mult * band, 4), round(mid, 4), round(mid - mult * band, 4)


# ── Volume ────────────────────────────────────────────────────────────────────


def volume_spike(
    vols: list[float], period: int = 20, threshold: float = 1.5
) -> tuple[bool, float] | None:
    """Returns (is_spike, ratio_vs_average)."""
    if len(vols) < period + 1:
        return None
    avg = sum(vols[-period - 1 : -1]) / period
    if avg == 0:
        return None
    ratio = vols[-1] / avg
    return ratio >= threshold, round(ratio, 2)


def vwap(candles: list[Candle]) -> float | None:
    """Session VWAP over the supplied candles (typically today's intraday bars)."""
    if not candles:
        return None
    cum_pv = 0.0
    cum_v = 0.0
    for c in candles:
        typical = (float(c["high"]) + float(c["low"]) + float(c["close"])) / 3
        vol = float(c["volume"])
        cum_pv += typical * vol
        cum_v += vol
    return round(cum_pv / cum_v, 4) if cum_v else None


# ── Price action ──────────────────────────────────────────────────────────────


def swing_breakout(h: list[float], low: list[float], c: list[float], lookback: int = 20) -> dict:
    """Recent range breakout + basic higher-highs/higher-lows (or lower/lower)
    structure over the last few swings, using the prior `lookback` bars
    excluding the current one as the reference range."""
    if len(c) < lookback + 3:
        return {"breakout_up": False, "breakout_down": False, "hh_hl": False, "lh_ll": False}
    ref_high = max(h[-lookback - 1 : -1])
    ref_low = min(low[-lookback - 1 : -1])
    breakout_up = c[-1] > ref_high
    breakout_down = c[-1] < ref_low
    # crude swing structure: compare last local highs/lows via simple 3-bar pivots
    recent_h, recent_l = h[-lookback:], low[-lookback:]
    pivots_h = [
        recent_h[i]
        for i in range(1, len(recent_h) - 1)
        if recent_h[i] > recent_h[i - 1] and recent_h[i] > recent_h[i + 1]
    ]
    pivots_l = [
        recent_l[i]
        for i in range(1, len(recent_l) - 1)
        if recent_l[i] < recent_l[i - 1] and recent_l[i] < recent_l[i + 1]
    ]
    higher_highs = len(pivots_h) >= 2 and pivots_h[-1] > pivots_h[-2]
    higher_lows = len(pivots_l) >= 2 and pivots_l[-1] > pivots_l[-2]
    lower_highs = len(pivots_h) >= 2 and pivots_h[-1] < pivots_h[-2]
    lower_lows = len(pivots_l) >= 2 and pivots_l[-1] < pivots_l[-2]
    hh_hl = higher_highs and higher_lows
    lh_ll = lower_highs and lower_lows
    return {
        "breakout_up": breakout_up,
        "breakout_down": breakout_down,
        "hh_hl": hh_hl,
        "lh_ll": lh_ll,
    }


def candlestick_confirmation(candles: list[Candle]) -> dict:
    """Very simple bullish/bearish confirmation off the last two candles
    (engulfing / strong close near the high or low of range)."""
    if len(candles) < 2:
        return {"bullish": False, "bearish": False}
    prev, cur = candles[-2], candles[-1]
    p_open, p_close = float(prev["open"]), float(prev["close"])
    c_open, c_close = float(cur["open"]), float(cur["close"])
    c_high, c_low = float(cur["high"]), float(cur["low"])
    rng = c_high - c_low
    bullish_engulf = (
        c_close > c_open and p_close < p_open and c_close >= p_open and c_open <= p_close
    )
    bearish_engulf = (
        c_close < c_open and p_close > p_open and c_close <= p_open and c_open >= p_close
    )
    strong_bull_close = rng > 0 and (c_close - c_low) / rng >= 0.7 and c_close > c_open
    strong_bear_close = rng > 0 and (c_high - c_close) / rng >= 0.7 and c_close < c_open
    return {
        "bullish": bullish_engulf or strong_bull_close,
        "bearish": bearish_engulf or strong_bear_close,
    }


# ── Order flow ────────────────────────────────────────────────────────────────


def oi_classification(price_change: float, oi_change: float) -> str:
    """Classic 4-quadrant futures order-flow read."""
    if price_change >= 0 and oi_change >= 0:
        return "long_build_up"
    if price_change < 0 and oi_change >= 0:
        return "short_build_up"
    if price_change >= 0 and oi_change < 0:
        return "short_covering"
    return "long_unwinding"
