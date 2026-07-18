"""Opening Range Breakout (ORB) strategy -- another hand-designed strategy
(like trend_pullback.py) that needs day-session logic the generic
combinatorial engine.py doesn't have:

  For each trading day:
    - The opening range is the high/low of bars falling within a
      configurable window (default 09:00-09:30).
    - Buy the first breakout above the range high with volume above its
      recent average -- at most one trade per day.
  Stop loss:  the opening range's low (not a % or ATR distance -- the
              range itself defines the invalidation level).
  Target:     entry + 2x ATR(14).
  Any position still open at the last bar of its trading day is squared
  off there (ORB is an intraday pattern; carrying it overnight changes
  the risk profile the range was measuring).

Day grouping is by calendar date (candle.time.date()) -- a simplification
that's fine for day-session instruments (NSE equities, MCX day session) but
doesn't handle an exchange segment whose session spans midnight.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time

from app.domain.models.historical_candle import HistoricalCandle
from app.domain.models.strategy_lab import TradeRecord
from app.domain.services.strategy_lab import indicators as ind
from app.domain.services.strategy_lab.engine import (
    BacktestOutcome,
    TransactionCosts,
    brokerage_cost,
    capped_quantity,
)

ATR_TARGET_MULT = 2.0
VOLUME_LOOKBACK = 20
RISK_PCT = 2.0


@dataclass
class OpeningRangeBreakoutParams:
    range_start: time = time(9, 0)
    range_end: time = time(9, 30)
    atr_target_mult: float = ATR_TARGET_MULT
    volume_lookback: int = VOLUME_LOOKBACK


def _day_groups(candles: list[HistoricalCandle]) -> dict[date, list[int]]:
    """Maps each calendar date to the (sorted) indices of candles on it."""
    groups: dict[date, list[int]] = {}
    for i, c in enumerate(candles):
        groups.setdefault(c.time.date(), []).append(i)
    return groups


def compute_opening_ranges(
    candles: list[HistoricalCandle], params: OpeningRangeBreakoutParams | None = None
) -> dict[date, tuple[float, float]]:
    """Maps each trading day to (range_high, range_low) computed from bars
    within [range_start, range_end) that day. A day with no bars in that
    window is omitted -- no breakout is attempted for it."""
    p = params or OpeningRangeBreakoutParams()
    ranges: dict[date, tuple[float, float]] = {}
    for day, idxs in _day_groups(candles).items():
        window = [
            candles[i] for i in idxs if p.range_start <= candles[i].time.time() < p.range_end
        ]
        if window:
            ranges[day] = (max(c.high for c in window), min(c.low for c in window))
    return ranges


def run_orb_backtest(
    candles: list[HistoricalCandle],
    capital: float,
    params: OpeningRangeBreakoutParams | None = None,
    costs: TransactionCosts | None = None,
) -> BacktestOutcome:
    p = params or OpeningRangeBreakoutParams()
    costs = costs or TransactionCosts()
    outcome = BacktestOutcome(final_equity=capital)
    n = len(candles)
    if n < 50:
        return outcome

    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    closes = [c.close for c in candles]
    volumes = [float(c.volume) for c in candles]
    atr_series = ind.atr(highs, lows, closes, 14)
    vol_sma = ind.sma(volumes, p.volume_lookback)
    opening_ranges = compute_opening_ranges(candles, p)
    day_groups = _day_groups(candles)

    equity = capital
    in_position = False
    entry_price = 0.0
    entry_time: datetime | None = None
    qty = 0
    stop_price = 0.0
    target_price = 0.0

    outcome.equity_curve.append({"time": candles[0].time.isoformat(), "equity": round(equity, 2)})

    def open_position(i: int, range_low: float) -> None:
        nonlocal in_position, entry_price, entry_time, qty, stop_price, target_price
        atr = atr_series[i]
        if atr is None or atr <= 0:
            return
        fill = candles[i].close * (1 + costs.slippage_pct / 100)
        stop_distance = fill - range_low
        if stop_distance <= 0:
            return  # range low is above/at entry -- not a usable stop, skip
        risk_amount = equity * RISK_PCT / 100
        q = capped_quantity(risk_amount, stop_distance, fill, equity)
        if q == 0:
            return
        in_position = True
        entry_price = fill
        entry_time = candles[i].time
        qty = q
        stop_price = range_low
        target_price = fill + p.atr_target_mult * atr

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
                exit_time=candles[i].time,
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

    for day, idxs in sorted(day_groups.items()):
        if day not in opening_ranges:
            continue
        range_high, range_low = opening_ranges[day]
        traded_today = False
        post_range_idxs = [i for i in idxs if candles[i].time.time() >= p.range_end]

        for pos, i in enumerate(post_range_idxs):
            bar = candles[i]
            is_last_bar_of_day = pos == len(post_range_idxs) - 1

            if in_position:
                if bar.low <= stop_price:
                    close_position(i, stop_price, "stop_loss")
                elif bar.high >= target_price:
                    close_position(i, target_price, "target")
                elif is_last_bar_of_day:
                    close_position(i, bar.close, "eod_squareoff")
            elif not traded_today:
                vol_avg = vol_sma[i]
                if (
                    vol_avg is not None
                    and bar.close > range_high
                    and volumes[i] > vol_avg
                ):
                    open_position(i, range_low)
                    traded_today = True

            outcome.equity_curve.append(
                {
                    "time": bar.time.isoformat(),
                    "equity": round(
                        equity + (bar.close - entry_price) * qty if in_position else equity, 2
                    ),
                }
            )

    outcome.final_equity = equity
    return outcome
