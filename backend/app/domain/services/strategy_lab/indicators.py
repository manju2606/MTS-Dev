"""Full-series technical indicators for backtesting -- every function below
returns one value *per input bar* (aligned by index, `None` during warmup),
unlike infra/ai/technical.py or infra/mcx/ng_indicators.py which mostly
return only the latest value for live-quote enrichment. A backtest needs the
indicator's value as of *every* historical bar to evaluate entry/exit rules
at each point in time, hence a separate module rather than reusing those.

All functions take plain float lists (closes/highs/lows/volumes) and are
pure -- no I/O, no external dependencies beyond the standard library.
"""

from __future__ import annotations

Series = list[float | None]


def sma(values: list[float], period: int) -> Series:
    out: Series = [None] * len(values)
    if len(values) < period:
        return out
    running = sum(values[:period])
    out[period - 1] = running / period
    for i in range(period, len(values)):
        running += values[i] - values[i - period]
        out[i] = running / period
    return out


def ema(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2.0 / (period + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def rsi(closes: list[float], period: int = 14) -> Series:
    out: Series = [None] * len(closes)
    if len(closes) < period + 1:
        return out
    gains = [max(closes[i] - closes[i - 1], 0.0) for i in range(1, period + 1)]
    losses = [max(closes[i - 1] - closes[i], 0.0) for i in range(1, period + 1)]
    avg_g = sum(gains) / period
    avg_l = sum(losses) / period
    out[period] = 100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    for i in range(period + 1, len(closes)):
        g = max(closes[i] - closes[i - 1], 0.0)
        loss = max(closes[i - 1] - closes[i], 0.0)
        avg_g = (avg_g * (period - 1) + g) / period
        avg_l = (avg_l * (period - 1) + loss) / period
        out[i] = 100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    return out


def macd(
    closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[list[float], list[float], list[float]]:
    ema_fast = ema(closes, fast)
    ema_slow = ema(closes, slow)
    macd_line = [f - s for f, s in zip(ema_fast, ema_slow, strict=True)]
    signal_line = ema(macd_line, signal)
    histogram = [m - s for m, s in zip(macd_line, signal_line, strict=True)]
    return macd_line, signal_line, histogram


def _true_range(highs: list[float], lows: list[float], closes: list[float]) -> list[float]:
    tr = [highs[0] - lows[0]]
    for i in range(1, len(closes)):
        tr.append(
            max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
        )
    return tr


def atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> Series:
    out: Series = [None] * len(closes)
    if len(closes) < period:
        return out
    tr = _true_range(highs, lows, closes)
    avg = sum(tr[:period]) / period
    out[period - 1] = avg
    for i in range(period, len(closes)):
        avg = (avg * (period - 1) + tr[i]) / period
        out[i] = avg
    return out


def bollinger(
    closes: list[float], period: int = 20, num_std: float = 2.0
) -> tuple[Series, Series, Series]:
    mid = sma(closes, period)
    upper: Series = [None] * len(closes)
    lower: Series = [None] * len(closes)
    for i in range(period - 1, len(closes)):
        window = closes[i - period + 1 : i + 1]
        m = mid[i]
        assert m is not None
        variance = sum((x - m) ** 2 for x in window) / period
        std = variance**0.5
        upper[i] = m + num_std * std
        lower[i] = m - num_std * std
    return mid, upper, lower


def adx(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> Series:
    n = len(closes)
    out: Series = [None] * n
    if n < 2 * period:
        return out

    tr = _true_range(highs, lows, closes)
    plus_dm = [0.0] * n
    minus_dm = [0.0] * n
    for i in range(1, n):
        up_move = highs[i] - highs[i - 1]
        down_move = lows[i - 1] - lows[i]
        if up_move > down_move and up_move > 0:
            plus_dm[i] = up_move
        if down_move > up_move and down_move > 0:
            minus_dm[i] = down_move

    def wilder_smooth(values: list[float]) -> list[float]:
        smoothed = [0.0] * n
        smoothed[period] = sum(values[1 : period + 1])
        for i in range(period + 1, n):
            smoothed[i] = smoothed[i - 1] - smoothed[i - 1] / period + values[i]
        return smoothed

    tr_smooth = wilder_smooth(tr)
    plus_smooth = wilder_smooth(plus_dm)
    minus_smooth = wilder_smooth(minus_dm)

    dx: list[float] = [0.0] * n
    for i in range(period, n):
        if tr_smooth[i] == 0:
            continue
        plus_di = 100 * plus_smooth[i] / tr_smooth[i]
        minus_di = 100 * minus_smooth[i] / tr_smooth[i]
        denom = plus_di + minus_di
        dx[i] = 100 * abs(plus_di - minus_di) / denom if denom else 0.0

    first = 2 * period - 1
    if first >= n:
        return out
    out[first] = sum(dx[period : first + 1]) / period
    for i in range(first + 1, n):
        prev = out[i - 1]
        assert prev is not None
        out[i] = (prev * (period - 1) + dx[i]) / period
    return out


def supertrend(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    period: int = 10,
    multiplier: float = 3.0,
) -> tuple[Series, list[int]]:
    """Returns (line, direction) where direction is +1 (uptrend, line acts as
    support) or -1 (downtrend, line acts as resistance); 0 during warmup."""
    n = len(closes)
    atr_series = atr(highs, lows, closes, period)
    line: Series = [None] * n
    direction = [0] * n

    start = next((i for i, v in enumerate(atr_series) if v is not None), None)
    if start is None:
        return line, direction

    final_upper = 0.0
    final_lower = 0.0
    for i in range(start, n):
        a = atr_series[i]
        assert a is not None
        basic_upper = (highs[i] + lows[i]) / 2 + multiplier * a
        basic_lower = (highs[i] + lows[i]) / 2 - multiplier * a

        if i == start:
            final_upper, final_lower = basic_upper, basic_lower
            direction[i] = 1 if closes[i] > basic_lower else -1
            line[i] = final_lower if direction[i] == 1 else final_upper
            continue

        final_upper = (
            basic_upper
            if (basic_upper < final_upper or closes[i - 1] > final_upper)
            else final_upper
        )
        final_lower = (
            basic_lower
            if (basic_lower > final_lower or closes[i - 1] < final_lower)
            else final_lower
        )

        if direction[i - 1] == 1:
            direction[i] = -1 if closes[i] < final_lower else 1
        else:
            direction[i] = 1 if closes[i] > final_upper else -1
        line[i] = final_lower if direction[i] == 1 else final_upper

    return line, direction


def cci(highs: list[float], lows: list[float], closes: list[float], period: int = 20) -> Series:
    n = len(closes)
    tp = [(highs[i] + lows[i] + closes[i]) / 3 for i in range(n)]
    tp_sma = sma(tp, period)
    out: Series = [None] * n
    for i in range(period - 1, n):
        m = tp_sma[i]
        assert m is not None
        mean_dev = sum(abs(x - m) for x in tp[i - period + 1 : i + 1]) / period
        out[i] = (tp[i] - m) / (0.015 * mean_dev) if mean_dev else 0.0
    return out


def roc(closes: list[float], period: int = 10) -> Series:
    out: Series = [None] * len(closes)
    for i in range(period, len(closes)):
        prev = closes[i - period]
        out[i] = (closes[i] - prev) / prev * 100 if prev else 0.0
    return out


def stochastic(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    k_period: int = 14,
    d_period: int = 3,
) -> tuple[Series, Series]:
    n = len(closes)
    k: Series = [None] * n
    for i in range(k_period - 1, n):
        window_h = highs[i - k_period + 1 : i + 1]
        window_l = lows[i - k_period + 1 : i + 1]
        hi, lo = max(window_h), min(window_l)
        k[i] = (closes[i] - lo) / (hi - lo) * 100 if hi != lo else 50.0
    k_values = [v if v is not None else 0.0 for v in k]
    d_raw = sma(k_values, d_period)
    d: Series = [d_raw[i] if k[i] is not None else None for i in range(n)]
    return k, d


def obv(closes: list[float], volumes: list[float]) -> list[float]:
    if not closes:
        return []
    out = [volumes[0]]
    for i in range(1, len(closes)):
        if closes[i] > closes[i - 1]:
            out.append(out[-1] + volumes[i])
        elif closes[i] < closes[i - 1]:
            out.append(out[-1] - volumes[i])
        else:
            out.append(out[-1])
    return out


def donchian(
    highs: list[float], lows: list[float], period: int = 20
) -> tuple[Series, Series, Series]:
    n = len(highs)
    upper: Series = [None] * n
    lower: Series = [None] * n
    mid: Series = [None] * n
    for i in range(period - 1, n):
        hi = max(highs[i - period + 1 : i + 1])
        lo = min(lows[i - period + 1 : i + 1])
        upper[i], lower[i], mid[i] = hi, lo, (hi + lo) / 2
    return upper, lower, mid


def keltner(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    period: int = 20,
    atr_mult: float = 2.0,
) -> tuple[list[float], Series, Series]:
    mid = ema(closes, period)
    atr_series = atr(highs, lows, closes, period)
    upper: Series = [None] * len(closes)
    lower: Series = [None] * len(closes)
    for i, a in enumerate(atr_series):
        if a is not None:
            upper[i] = mid[i] + atr_mult * a
            lower[i] = mid[i] - atr_mult * a
    return mid, upper, lower


def vwap(
    highs: list[float], lows: list[float], closes: list[float], volumes: list[float]
) -> list[float]:
    """Cumulative VWAP over the whole supplied range -- for a multi-day
    range this is a running average, not a per-session reset; fine for
    intraday-interval backtests over a single or few sessions, less
    meaningful stretched across months of daily candles."""
    out = []
    cum_pv, cum_v = 0.0, 0.0
    for i in range(len(closes)):
        tp = (highs[i] + lows[i] + closes[i]) / 3
        cum_pv += tp * volumes[i]
        cum_v += volumes[i]
        out.append(cum_pv / cum_v if cum_v else tp)
    return out
