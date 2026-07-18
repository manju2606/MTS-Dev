"""Live deployment of the RSI-14 Reversion strategy for Natural Gas Mini --
the #1 ranked, walk-forward-validated candidate out of all 392 tested in the
AI Strategy Lab (see generator.py's rsi_reversion family for the same
params, and rsi_reversion_v2.py for the long+short backtest engine this
mirrors exactly, both v1.0 long-only and v2.0 long+short).

Unlike a backtest, this does not force-close an open position at the end of
the candle series -- it replays the exact same stop/target/trailing-stop/
RSI-exit logic across the whole available history and reports whatever the
state actually is *right now* (flat, or in a position with live stop/target/
trailing levels, long or short), so a caller can render it as a real-time
BUY/SELL signal. Being a pure replay of deterministic history, calling this
fresh on every request naturally reconstructs "is a position currently open"
without any server-side state to persist -- state persistence only enters
the picture for email-alert dedup (see mcx_rsi_signal_service.py), not here.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.domain.models.historical_candle import HistoricalCandle
from app.domain.services.strategy_lab import indicators as ind
from app.domain.services.strategy_lab.engine import TransactionCosts, brokerage_cost, capped_quantity
from app.domain.services.strategy_lab.rsi_reversion_v2 import RsiReversionParams

POSITION_SIZE_PCT = 2.0  # % of capital risked per trade, same convention as the generator


@dataclass
class LiveSignalState:
    status: str  # "FLAT" | "IN_POSITION"
    direction: str | None  # "LONG" | "SHORT" | None
    rsi: float | None
    as_of: datetime
    entry_time: datetime | None = None
    entry_price: float | None = None
    stop_loss: float | None = None
    target: float | None = None
    trailing_stop: float | None = None
    last_signal: str | None = None  # "BUY" | "SELL" | "EXIT"
    last_signal_time: datetime | None = None
    last_signal_price: float | None = None
    last_exit_reason: str | None = None


@dataclass
class LiveTrade:
    """One completed entry -> exit round trip, for the "trades so far" log
    surfaced in the RSI Strategy tab -- lets a user see the actual signal
    history without any DB persistence, since it's derived from the same
    replay as the current state."""

    direction: str  # "LONG" | "SHORT"
    entry_time: datetime
    entry_price: float
    exit_time: datetime
    exit_price: float
    exit_reason: str
    pnl: float
    pnl_pct: float


def compute_live_state(
    candles: list[HistoricalCandle],
    capital: float = 100_000.0,
    params: RsiReversionParams | None = None,
) -> tuple[LiveSignalState, list[LiveTrade]]:
    p = params or RsiReversionParams()
    n = len(candles)
    now = candles[-1].time if n else datetime.utcnow()
    if n < p.period + 1:
        return LiveSignalState(status="FLAT", direction=None, rsi=None, as_of=now), []

    closes = [c.close for c in candles]
    rsi_vals = ind.rsi(closes, p.period)
    costs = TransactionCosts()

    equity = capital
    direction = 0  # 0 flat, 1 long, -1 short
    entry_price = 0.0
    entry_time: datetime | None = None
    qty = 0
    stop_price = 0.0
    target_price = 0.0
    trail_price: float | None = None

    last_signal: str | None = None
    last_signal_time: datetime | None = None
    last_signal_price: float | None = None
    last_exit_reason: str | None = None
    trades: list[LiveTrade] = []

    def open_long(i: int) -> None:
        nonlocal direction, entry_price, entry_time, qty, stop_price, target_price, trail_price
        nonlocal last_signal, last_signal_time, last_signal_price
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
        last_signal, last_signal_time, last_signal_price = "BUY", candles[i].time, fill

    def open_short(i: int) -> None:
        nonlocal direction, entry_price, entry_time, qty, stop_price, target_price, trail_price
        nonlocal last_signal, last_signal_time, last_signal_price
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
        last_signal, last_signal_time, last_signal_price = "SELL", candles[i].time, fill

    def close_position(i: int, exit_price: float, reason: str) -> None:
        nonlocal direction, equity, last_signal, last_signal_time, last_signal_price, last_exit_reason
        is_long = direction == 1
        fill = exit_price * (1 - costs.slippage_pct / 100 if is_long else 1 + costs.slippage_pct / 100)
        entry_cost = brokerage_cost(entry_price * qty, costs)
        exit_cost = brokerage_cost(fill * qty, costs) + fill * qty * costs.stt_pct / 100
        raw_pnl = (fill - entry_price) * qty if is_long else (entry_price - fill) * qty
        pnl = raw_pnl - entry_cost - exit_cost
        pnl_pct = pnl / (entry_price * qty) * 100 if entry_price * qty else 0.0
        equity += pnl
        last_signal, last_signal_time, last_signal_price = "EXIT", candles[i].time, fill
        last_exit_reason = reason
        assert entry_time is not None
        trades.append(
            LiveTrade(
                direction="LONG" if is_long else "SHORT",
                entry_time=entry_time,
                entry_price=round(entry_price, 4),
                exit_time=candles[i].time,
                exit_price=round(fill, 4),
                exit_reason=reason,
                pnl=round(pnl, 2),
                pnl_pct=round(pnl_pct, 2),
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

    as_of = candles[-1].time
    if direction != 0:
        state = LiveSignalState(
            status="IN_POSITION",
            direction="LONG" if direction == 1 else "SHORT",
            rsi=rsi_vals[-1],
            as_of=as_of,
            entry_time=entry_time,
            entry_price=round(entry_price, 4),
            stop_loss=round(stop_price, 4),
            target=round(target_price, 4),
            trailing_stop=round(trail_price, 4) if trail_price is not None else None,
            last_signal=last_signal,
            last_signal_time=last_signal_time,
            last_signal_price=round(last_signal_price, 4) if last_signal_price is not None else None,
            last_exit_reason=last_exit_reason,
        )
    else:
        state = LiveSignalState(
            status="FLAT",
            direction=None,
            rsi=rsi_vals[-1],
            as_of=as_of,
            last_signal=last_signal,
            last_signal_time=last_signal_time,
            last_signal_price=round(last_signal_price, 4) if last_signal_price is not None else None,
            last_exit_reason=last_exit_reason,
        )
    return state, trades
