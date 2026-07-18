"""RSI-14 Reversion -- the AI Strategy Lab's #1 ranked, walk-forward-
validated candidate for Natural Gas Mini (see generator.py's rsi_reversion
family, params oversold=20/overbought=80, SL 2.5%/target 5.0%/trailing stop
2.0%). That family (and the live deployment in rsi_reversion_live.py) is
long-only, per engine.py's own note that shorting "doubles the family-signal
logic" and wasn't needed for the general 392-candidate sweep.

This module adds a v2.0 variant with a short leg -- symmetric mirror of the
long side (short when RSI > overbought while flat, cover on a stop/target/
RSI<oversold), same position-management style as trend_pullback.py/
opening_range_breakout.py (a dedicated engine, not routed through engine.py's
family dispatch, since it needs bidirectional state that the shared
single-position-always-long loop doesn't support). v1.0 here is the exact
same long-only logic as the validated live strategy, kept as the baseline
for an honest v1-vs-v2 comparison.
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

RSI_PERIOD = 14
OVERSOLD = 20.0
OVERBOUGHT = 80.0
STOP_LOSS_PCT = 2.5
TARGET_PCT = 5.0
TRAILING_STOP_PCT = 2.0
POSITION_SIZE_PCT = 2.0


@dataclass
class RsiReversionParams:
    period: int = RSI_PERIOD
    oversold: float = OVERSOLD
    overbought: float = OVERBOUGHT
    stop_loss_pct: float = STOP_LOSS_PCT
    target_pct: float = TARGET_PCT
    trailing_stop_pct: float = TRAILING_STOP_PCT
    allow_short: bool = False


RSI_REVERSION_VERSIONS: dict[str, RsiReversionParams] = {
    "v1.0": RsiReversionParams(allow_short=False),
    "v2.0": RsiReversionParams(allow_short=True),
}


def run_rsi_reversion_backtest(
    candles: list[HistoricalCandle],
    capital: float,
    params: RsiReversionParams | None = None,
    costs: TransactionCosts | None = None,
) -> BacktestOutcome:
    p = params or RsiReversionParams()
    costs = costs or TransactionCosts()
    n = len(candles)
    outcome = BacktestOutcome(final_equity=capital)
    if n < p.period + 1:
        return outcome

    closes = [c.close for c in candles]
    rsi_vals = ind.rsi(closes, p.period)

    equity = capital
    direction = 0  # 0 flat, 1 long, -1 short
    entry_price = 0.0
    entry_time: datetime | None = None
    qty = 0
    stop_price = 0.0
    target_price = 0.0
    trail_price: float | None = None

    outcome.equity_curve.append(
        {"time": candles[0].time.isoformat(), "equity": round(equity, 2)}
    )

    def open_long(i: int) -> None:
        nonlocal direction, entry_price, entry_time, qty, stop_price, target_price, trail_price
        fill = candles[i].close * (1 + costs.slippage_pct / 100)
        risk_amount = equity * POSITION_SIZE_PCT / 100
        stop_distance = fill * p.stop_loss_pct / 100
        q = capped_quantity(risk_amount, stop_distance, fill, equity)
        if q == 0:
            return
        direction = 1
        entry_price = fill
        entry_time = candles[i].time
        qty = q
        stop_price = fill * (1 - p.stop_loss_pct / 100)
        target_price = fill * (1 + p.target_pct / 100)
        trail_price = None

    def open_short(i: int) -> None:
        nonlocal direction, entry_price, entry_time, qty, stop_price, target_price, trail_price
        fill = candles[i].close * (1 - costs.slippage_pct / 100)
        risk_amount = equity * POSITION_SIZE_PCT / 100
        stop_distance = fill * p.stop_loss_pct / 100
        q = capped_quantity(risk_amount, stop_distance, fill, equity)
        if q == 0:
            return
        direction = -1
        entry_price = fill
        entry_time = candles[i].time
        qty = q
        stop_price = fill * (1 + p.stop_loss_pct / 100)
        target_price = fill * (1 - p.target_pct / 100)
        trail_price = None

    def close_position(i: int, exit_price: float, reason: str) -> None:
        nonlocal direction, equity
        is_long = direction == 1
        fill = exit_price * (1 - costs.slippage_pct / 100 if is_long else 1 + costs.slippage_pct / 100)
        entry_cost = brokerage_cost(entry_price * qty, costs)
        exit_cost = brokerage_cost(fill * qty, costs) + fill * qty * costs.stt_pct / 100
        raw_pnl = (fill - entry_price) * qty if is_long else (entry_price - fill) * qty
        pnl = raw_pnl - entry_cost - exit_cost
        pnl_pct = pnl / (entry_price * qty) * 100 if entry_price * qty else 0.0
        equity += pnl
        assert entry_time is not None
        outcome.trades.append(
            TradeRecord(
                entry_time=entry_time,
                exit_time=candles[i].time,
                signal="BUY" if is_long else "SELL",
                entry_price=round(entry_price, 4),
                exit_price=round(fill, 4),
                quantity=qty,
                pnl=round(pnl, 2),
                pnl_pct=round(pnl_pct, 2),
                exit_reason=reason,
            )
        )
        direction = 0

    for i in range(1, n):
        bar = candles[i]
        r = rsi_vals[i]

        if direction == 1:
            candidate_trail = bar.close * (1 - p.trailing_stop_pct / 100)
            trail_price = candidate_trail if trail_price is None else max(trail_price, candidate_trail)
            effective_stop = max(stop_price, trail_price)

            if bar.low <= effective_stop:
                reason = "trailing_stop" if effective_stop == trail_price else "stop_loss"
                close_position(i, effective_stop, reason)
            elif bar.high >= target_price:
                close_position(i, target_price, "target")
            elif r is not None and r > p.overbought:
                close_position(i, bar.close, "signal")

        elif direction == -1:
            candidate_trail = bar.close * (1 + p.trailing_stop_pct / 100)
            trail_price = candidate_trail if trail_price is None else min(trail_price, candidate_trail)
            effective_stop = min(stop_price, trail_price)

            if bar.high >= effective_stop:
                reason = "trailing_stop" if effective_stop == trail_price else "stop_loss"
                close_position(i, effective_stop, reason)
            elif bar.low <= target_price:
                close_position(i, target_price, "target")
            elif r is not None and r < p.oversold:
                close_position(i, bar.close, "signal")

        else:
            if r is not None and r < p.oversold:
                open_long(i)
            elif p.allow_short and r is not None and r > p.overbought:
                open_short(i)

        if i % 5 == 0 or i == n - 1:
            if direction == 1:
                mtm = equity + (bar.close - entry_price) * qty
            elif direction == -1:
                mtm = equity + (entry_price - bar.close) * qty
            else:
                mtm = equity
            outcome.equity_curve.append({"time": bar.time.isoformat(), "equity": round(mtm, 2)})

    if direction != 0:
        close_position(n - 1, candles[-1].close, "eod")
        outcome.equity_curve.append(
            {"time": candles[-1].time.isoformat(), "equity": round(equity, 2)}
        )

    outcome.final_equity = equity
    return outcome
