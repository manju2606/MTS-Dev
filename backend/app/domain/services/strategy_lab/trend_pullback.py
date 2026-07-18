"""Trend Pullback strategy -- a specific, hand-designed multi-timeframe
strategy (not one of the generator.py combinatorial families, since it
needs two different candle timeframes at once, which the generic single-
timeframe engine.py doesn't support):

  Timeframe:    5-minute execution, 1-hour 200 EMA trend filter
  Buy when ALL of:
    - close (5m) above the 1-hour 200 EMA (aligned onto the 5m timeline)
    - EMA20 > EMA50 on the 5-minute chart
    - ADX(14, 5m) > 25
    - price has pulled back to (touched or come within 0.3% of) EMA20
    - the pullback bar closes bullish (close > open)
    - volume above its 20-bar average
  Stop loss:  entry - 1x ATR(14, 5m)
  Target:     entry + 2.5x ATR(14, 5m) (midpoint of the requested 2-3x),
              exited early if SuperTrend(10, 3, 5m) flips bearish first --
              this is the "trail using SuperTrend" alternative from the
              spec, applied as an early-exit rather than a second target
              so a reversal cuts the trade loose before giving back gains.

Participates in established trends rather than buying every dip, per the
brief -- the 1H trend filter + ADX threshold are what separate this from a
generic EMA-pullback strategy that fires in choppy/ranging markets too.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.domain.models.historical_candle import HistoricalCandle
from app.domain.models.strategy_lab import TradeRecord
from app.domain.services.strategy_lab import indicators as ind
from app.domain.services.strategy_lab.engine import (
    BacktestOutcome,
    TransactionCosts,
    brokerage_cost,
    capped_quantity,
)

ADX_THRESHOLD = 25.0
PULLBACK_TOLERANCE = 0.003  # 0.3% -- "pulls back toward EMA20"
ATR_STOP_MULT = 1.0
ATR_TARGET_MULT = 2.5  # midpoint of the requested 2-3x range
VOLUME_LOOKBACK = 20
RISK_PCT = 2.0  # % of capital risked per trade, same convention as the generator


@dataclass
class TrendPullbackParams:
    adx_threshold: float = ADX_THRESHOLD
    pullback_tolerance: float = PULLBACK_TOLERANCE
    atr_stop_mult: float = ATR_STOP_MULT
    atr_target_mult: float = ATR_TARGET_MULT
    # Once unrealized profit reaches this many ATRs, the stop moves to
    # breakeven (entry price) -- protects against giving back a confirmed
    # move. None disables it (v1.0/v2.0 behavior).
    breakeven_trigger_atr: float | None = None


# v1.0 is the strategy exactly as originally specified. v2.0 tightens the
# three levers that a real parameter sweep against live Natural Gas 5m/1H
# data (see conversation history) showed *consistently* reduce drawdown and
# improve profit factor across many combinations -- not a single lucky
# result. It does NOT touch atr_target_mult: standalone target changes
# tested worse or were only "profitable" in combinations that failed
# walk-forward validation (the apparent edge came from a handful of trades
# in one short test window, with the larger training window still losing).
# v2.0 is a genuine risk-reduction upgrade, not a validated profitable edge
# -- there isn't enough real MCX history available (contracts roll monthly)
# to validate profitability with statistical confidence yet.
TREND_PULLBACK_VERSIONS: dict[str, TrendPullbackParams] = {
    "v1.0": TrendPullbackParams(),
    "v2.0": TrendPullbackParams(adx_threshold=35, atr_stop_mult=1.5, pullback_tolerance=0.0015),
}


def _align_htf_to_ltf(
    ltf_times: list[datetime], htf_times: list[datetime], htf_values: list[float]
) -> list[float | None]:
    """For each lower-timeframe bar, the most recent higher-timeframe value
    as of a *completed* HTF bar at or before that time (never looks ahead
    into an HTF bar that hasn't closed yet)."""
    out: list[float | None] = []
    htf_idx = -1
    for t in ltf_times:
        while htf_idx + 1 < len(htf_times) and htf_times[htf_idx + 1] <= t:
            htf_idx += 1
        out.append(htf_values[htf_idx] if htf_idx >= 0 else None)
    return out


def compute_signals(
    candles_5m: list[HistoricalCandle],
    candles_1h: list[HistoricalCandle],
    params: TrendPullbackParams | None = None,
) -> tuple[list[bool], list[float | None], list[int]]:
    """Returns (entry_signal, atr_series, supertrend_direction) aligned to
    candles_5m -- engine-agnostic so it's independently testable."""
    p = params or TrendPullbackParams()
    n = len(candles_5m)

    closes = [c.close for c in candles_5m]
    highs = [c.high for c in candles_5m]
    lows = [c.low for c in candles_5m]
    opens = [c.open for c in candles_5m]
    volumes = [float(c.volume) for c in candles_5m]

    ema20 = ind.ema(closes, 20)
    ema50 = ind.ema(closes, 50)
    adx = ind.adx(highs, lows, closes, 14)
    atr = ind.atr(highs, lows, closes, 14)
    vol_sma = ind.sma(volumes, VOLUME_LOOKBACK)
    _, st_direction = ind.supertrend(highs, lows, closes, 10, 3.0)

    ema200_1h = ind.ema([c.close for c in candles_1h], 200)
    htf_times = [c.time for c in candles_1h]
    ema200_aligned = _align_htf_to_ltf([c.time for c in candles_5m], htf_times, ema200_1h)

    entry = [False] * n
    for i in range(50, n):
        trend_ema = ema200_aligned[i]
        adx_i = adx[i]
        vol_avg = vol_sma[i]
        e20 = ema20[i]
        if trend_ema is None or adx_i is None or vol_avg is None:
            continue

        above_htf_trend = closes[i] > trend_ema
        ema_stack_bullish = ema20[i] > ema50[i]
        strong_trend = adx_i > p.adx_threshold
        pulled_back = lows[i] <= e20 * (1 + p.pullback_tolerance)
        bullish_close = closes[i] > opens[i]
        volume_confirmed = volumes[i] > vol_avg

        entry[i] = (
            above_htf_trend
            and ema_stack_bullish
            and strong_trend
            and pulled_back
            and bullish_close
            and volume_confirmed
        )

    return entry, atr, st_direction


def run_trend_pullback_backtest(
    candles_5m: list[HistoricalCandle],
    candles_1h: list[HistoricalCandle],
    capital: float,
    params: TrendPullbackParams | None = None,
    costs: TransactionCosts | None = None,
) -> BacktestOutcome:
    p = params or TrendPullbackParams()
    costs = costs or TransactionCosts()
    outcome = BacktestOutcome(final_equity=capital)
    if len(candles_5m) < 250 or len(candles_1h) < 10:
        return outcome

    entry_signal, atr_series, st_direction = compute_signals(candles_5m, candles_1h, p)
    n = len(candles_5m)

    equity = capital
    in_position = False
    entry_price = 0.0
    entry_time: datetime | None = None
    qty = 0
    stop_price = 0.0
    target_price = 0.0
    entry_atr = 0.0
    breakeven_moved = False

    outcome.equity_curve.append(
        {"time": candles_5m[0].time.isoformat(), "equity": round(equity, 2)}
    )

    def open_position(i: int) -> None:
        nonlocal in_position, entry_price, entry_time, qty, stop_price, target_price
        nonlocal entry_atr, breakeven_moved
        atr = atr_series[i]
        if atr is None or atr <= 0:
            return
        fill = candles_5m[i].close * (1 + costs.slippage_pct / 100)
        risk_amount = equity * RISK_PCT / 100
        stop_distance = p.atr_stop_mult * atr
        q = capped_quantity(risk_amount, stop_distance, fill, equity)
        if q == 0:
            return
        in_position = True
        entry_price = fill
        entry_time = candles_5m[i].time
        qty = q
        stop_price = fill - p.atr_stop_mult * atr
        target_price = fill + p.atr_target_mult * atr
        entry_atr = atr
        breakeven_moved = False

    def close_position(i: int, exit_price: float, reason: str) -> None:
        nonlocal in_position, equity
        fill = exit_price * (1 - costs.slippage_pct / 100)
        entry_cost = brokerage_cost(entry_price * qty, costs)
        exit_cost = brokerage_cost(fill * qty, costs) + fill * qty * costs.stt_pct / 100
        pnl = (fill - entry_price) * qty - entry_cost - exit_cost
        pnl_pct = pnl / (entry_price * qty) * 100 if entry_price * qty else 0.0
        equity += pnl
        assert entry_time is not None
        outcome.trades.append(
            TradeRecord(
                entry_time=entry_time,
                exit_time=candles_5m[i].time,
                signal="BUY",
                entry_price=round(entry_price, 4),
                exit_price=round(fill, 4),
                quantity=qty,
                pnl=round(pnl, 2),
                pnl_pct=round(pnl_pct, 2),
                exit_reason=reason,
            )
        )
        in_position = False

    for i in range(1, n):
        bar = candles_5m[i]

        if in_position:
            if (
                p.breakeven_trigger_atr is not None
                and not breakeven_moved
                and bar.high >= entry_price + p.breakeven_trigger_atr * entry_atr
            ):
                stop_price = max(stop_price, entry_price)
                breakeven_moved = True

            if bar.low <= stop_price:
                close_position(i, stop_price, "breakeven_stop" if breakeven_moved else "stop_loss")
            elif bar.high >= target_price:
                close_position(i, target_price, "target")
            elif st_direction[i - 1] == 1 and st_direction[i] == -1:
                close_position(i, bar.close, "supertrend_flip")
        elif entry_signal[i]:
            open_position(i)

        if i % 5 == 0 or i == n - 1:
            mtm = equity + (bar.close - entry_price) * qty if in_position else equity
            outcome.equity_curve.append({"time": bar.time.isoformat(), "equity": round(mtm, 2)})

    if in_position:
        close_position(n - 1, candles_5m[-1].close, "eod")
        outcome.equity_curve.append(
            {"time": candles_5m[-1].time.isoformat(), "equity": round(equity, 2)}
        )

    outcome.final_equity = equity
    return outcome
