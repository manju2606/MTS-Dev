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
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

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

_IST = ZoneInfo("Asia/Kolkata")
_ET = ZoneInfo("America/New_York")

# EIA Weekly Natural Gas Storage Report: every Thursday, 10:30 AM ET (the
# one major recurring scheduled event that specifically moves NG prices --
# see mcx_ai_score_service.py's own note that a full economic calendar,
# EIA/OPEC/FOMC/RBI, isn't available; this hardcodes just EIA's own fixed
# weekly cadence rather than needing a live calendar feed). Known gap: on a
# US holiday week the report sometimes shifts to Wednesday or Friday --
# not accounted for here, so a handful of weeks a year this window will be
# on the wrong day. Computed live from the candle's own timestamp (assumed
# IST-naive, matching how MCX candles are stored elsewhere in this app),
# not a stored calendar, so it never goes stale.
EIA_REPORT_WEEKDAY = 3  # Thursday (Mon=0)
EIA_REPORT_HOUR_ET = 10
EIA_REPORT_MINUTE_ET = 30


@dataclass
class RsiReversionParams:
    period: int = RSI_PERIOD
    oversold: float = OVERSOLD
    overbought: float = OVERBOUGHT
    stop_loss_pct: float = STOP_LOSS_PCT
    target_pct: float = TARGET_PCT
    trailing_stop_pct: float = TRAILING_STOP_PCT
    allow_short: bool = False

    # v3.0 -- Time Filter: block new entries within this window around the
    # weekly EIA Natural Gas Storage Report (volatility/slippage spike risk).
    time_filter_enabled: bool = False
    eia_window_before_minutes: int = 30
    eia_window_after_minutes: int = 60

    # v3.0 -- Volatility Filter: compares current ATR to its own trailing
    # average (atr_avg_period bars). Between elevated and extreme, widen the
    # stop (bigger stop = smaller risk-based position size, same total risk
    # budget); at or above extreme, skip the entry entirely.
    atr_filter_enabled: bool = False
    atr_avg_period: int = 20
    atr_elevated_multiple: float = 1.3
    atr_extreme_multiple: float = 2.0
    atr_widen_factor: float = 1.5

    # v2.1 (experimental, on top of v2.0's long+short base) -- Regime
    # Filter: RSI reversion is a counter-trend strategy, and its worst
    # trades come from firing into a market that's trending hard enough to
    # stay "oversold"/"overbought" for a long stretch without reverting.
    # ADX < regime_adx_max requires the market to be non-trending/ranging
    # (same ADX(14) indicator and >25 "confirmed trend" threshold Trend
    # Pullback already uses for the opposite purpose -- there it CONFIRMS a
    # trend to follow; here it's inverted to REQUIRE the absence of one,
    # since a reversion entry fighting a real trend is exactly the failure
    # mode this is meant to filter out).
    regime_filter_enabled: bool = False
    regime_adx_max: float = 25.0

    # v4.0 (experimental, on top of v2.2's regime-filtered base) -- Partial
    # Profit-Taking: changes *how a winning trade is exited* rather than
    # adding another entry filter (every prior variant only touched entry
    # conditions, and stacking more of those risks over-filtering into too
    # few trades to mean anything -- see v3.1). Instead of closing the whole
    # position at the fixed target, take partial_exit_fraction of it off
    # there and let the remainder run under just the stop/trailing-stop/RSI
    # exit (no fixed ceiling anymore), so a trade that keeps extending past
    # the original target captures more of the move.
    partial_exit_enabled: bool = False
    partial_exit_fraction: float = 0.5


RSI_REVERSION_VERSIONS: dict[str, RsiReversionParams] = {
    "v1.0": RsiReversionParams(allow_short=False),
    "v2.0": RsiReversionParams(allow_short=True),
    "v2.1": RsiReversionParams(allow_short=True, regime_filter_enabled=True),  # ADX < 25 (tightest)
    # ADX < 30 -- a real ADX-threshold sensitivity sweep (see conversation)
    # found this the most walk-forward-consistent of 25/30/35: lowest max
    # drawdown of every variant tested (including v2.1's 25), best stability
    # score, and train/test profit factor nearly identical (2.46 vs 2.51) --
    # the strongest walk-forward agreement seen in this strategy family so
    # far, on a still-thin-but-more-reasonable 25-trade sample. Trades off
    # v2.1's higher raw profit factor (4.2 vs 2.49) for that consistency.
    "v2.2": RsiReversionParams(allow_short=True, regime_filter_enabled=True, regime_adx_max=30.0),
    "v3.0": RsiReversionParams(allow_short=True, time_filter_enabled=True, atr_filter_enabled=True),
    # v3.0's Time+Volatility filters plus v2.1's Regime filter, all three
    # stacked -- experimental, testing whether they compound or fight each
    # other (e.g. the regime filter alone already cuts trade count ~83%;
    # stacking more filters on top could over-filter into too few trades to
    # mean anything).
    "v3.1": RsiReversionParams(
        allow_short=True, time_filter_enabled=True, atr_filter_enabled=True, regime_filter_enabled=True,
    ),
    # v2.2's regime-filtered base (the current live default) + partial
    # profit-taking (see RsiReversionParams' own docstring) -- isolates the
    # effect of the new exit mechanic against the current best, rather than
    # bundling it with an unrelated entry-filter change.
    "v4.0": RsiReversionParams(
        allow_short=True, regime_filter_enabled=True, regime_adx_max=30.0, partial_exit_enabled=True,
    ),
}


def is_near_eia_report(
    ist_naive_dt: datetime, before_minutes: int = 30, after_minutes: int = 60
) -> bool:
    """True if `ist_naive_dt` (an MCX candle timestamp, assumed IST-naive)
    falls within [before_minutes before, after_minutes after] this week's
    EIA Natural Gas Storage Report (Thursday 10:30 AM ET, converted via
    zoneinfo so US daylight saving is handled correctly rather than a
    hardcoded UTC offset)."""
    aware_ist = ist_naive_dt.replace(tzinfo=_IST)
    et = aware_ist.astimezone(_ET)
    if et.weekday() != EIA_REPORT_WEEKDAY:
        return False
    report_time = et.replace(
        hour=EIA_REPORT_HOUR_ET, minute=EIA_REPORT_MINUTE_ET, second=0, microsecond=0
    )
    window_start = report_time - timedelta(minutes=before_minutes)
    window_end = report_time + timedelta(minutes=after_minutes)
    return window_start <= et <= window_end


def _rolling_atr_avg(atr_series: list[float | None], period: int) -> list[float | None]:
    """Simple trailing average of whatever valid ATR values exist in the
    window -- grows in from a partial window rather than requiring a full
    `period` of non-None values, since ATR's own warmup already eats the
    first `period` bars."""
    n = len(atr_series)
    out: list[float | None] = [None] * n
    for i in range(n):
        window = [v for v in atr_series[max(0, i - period + 1) : i + 1] if v is not None]
        if window:
            out[i] = sum(window) / len(window)
    return out


def _volatility_state(
    atr_now: float | None, atr_avg: float | None, p: RsiReversionParams
) -> str:
    """"normal" | "widen" | "skip" -- see RsiReversionParams' own docstring
    on the elevated/extreme thresholds."""
    if not p.atr_filter_enabled or atr_now is None or atr_avg is None or atr_avg <= 0:
        return "normal"
    ratio = atr_now / atr_avg
    if ratio >= p.atr_extreme_multiple:
        return "skip"
    if ratio >= p.atr_elevated_multiple:
        return "widen"
    return "normal"


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
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    rsi_vals = ind.rsi(closes, p.period)
    atr_vals = ind.atr(highs, lows, closes, 14) if p.atr_filter_enabled else [None] * n
    atr_avg_vals = _rolling_atr_avg(atr_vals, p.atr_avg_period) if p.atr_filter_enabled else [None] * n
    adx_vals = ind.adx(highs, lows, closes, 14) if p.regime_filter_enabled else [None] * n

    equity = capital
    direction = 0  # 0 flat, 1 long, -1 short
    entry_price = 0.0
    entry_time: datetime | None = None
    qty = 0            # remaining open quantity (shrinks on a partial exit)
    original_qty = 0   # total quantity at entry -- used for the trade record + blended exit price
    stop_price = 0.0
    target_price = 0.0
    trail_price: float | None = None
    partial_taken = False
    partial_pnl = 0.0
    partial_notional = 0.0

    outcome.equity_curve.append(
        {"time": candles[0].time.isoformat(), "equity": round(equity, 2)}
    )

    def open_long(i: int, stop_pct: float) -> None:
        nonlocal direction, entry_price, entry_time, qty, original_qty, stop_price, target_price, trail_price
        nonlocal partial_taken, partial_pnl, partial_notional
        fill = candles[i].close * (1 + costs.slippage_pct / 100)
        risk_amount = equity * POSITION_SIZE_PCT / 100
        stop_distance = fill * stop_pct / 100
        q = capped_quantity(risk_amount, stop_distance, fill, equity)
        if q == 0:
            return
        direction = 1
        entry_price = fill
        entry_time = candles[i].time
        qty = q
        original_qty = q
        stop_price = fill * (1 - stop_pct / 100)
        target_price = fill * (1 + p.target_pct / 100)
        trail_price = None
        partial_taken = False
        partial_pnl = 0.0
        partial_notional = 0.0

    def open_short(i: int, stop_pct: float) -> None:
        nonlocal direction, entry_price, entry_time, qty, original_qty, stop_price, target_price, trail_price
        nonlocal partial_taken, partial_pnl, partial_notional
        fill = candles[i].close * (1 - costs.slippage_pct / 100)
        risk_amount = equity * POSITION_SIZE_PCT / 100
        stop_distance = fill * stop_pct / 100
        q = capped_quantity(risk_amount, stop_distance, fill, equity)
        if q == 0:
            return
        direction = -1
        entry_price = fill
        entry_time = candles[i].time
        qty = q
        original_qty = q
        stop_price = fill * (1 + stop_pct / 100)
        target_price = fill * (1 - p.target_pct / 100)
        trail_price = None
        partial_taken = False
        partial_pnl = 0.0
        partial_notional = 0.0

    def take_partial(i: int, exit_price: float) -> None:
        """Realizes P&L on partial_exit_fraction of the position at the
        (now-passed) target price, shrinks `qty` for the remainder, and
        marks partial_taken so the target-close branch below stops firing
        for this position -- the remainder now only exits via stop/
        trailing-stop/RSI signal."""
        nonlocal qty, partial_taken, partial_pnl, partial_notional, equity
        is_long = direction == 1
        fill = exit_price * (1 - costs.slippage_pct / 100 if is_long else 1 + costs.slippage_pct / 100)
        leg_qty = int(original_qty * p.partial_exit_fraction)
        if leg_qty <= 0 or leg_qty >= qty:
            return
        entry_cost = brokerage_cost(entry_price * leg_qty, costs)
        exit_cost = brokerage_cost(fill * leg_qty, costs) + fill * leg_qty * costs.stt_pct / 100
        raw_pnl = (fill - entry_price) * leg_qty if is_long else (entry_price - fill) * leg_qty
        pnl = raw_pnl - entry_cost - exit_cost
        partial_pnl += pnl
        partial_notional += fill * leg_qty
        qty -= leg_qty
        partial_taken = True
        equity += pnl

    def close_position(i: int, exit_price: float, reason: str) -> None:
        nonlocal direction, equity
        is_long = direction == 1
        fill = exit_price * (1 - costs.slippage_pct / 100 if is_long else 1 + costs.slippage_pct / 100)
        entry_cost = brokerage_cost(entry_price * qty, costs)
        exit_cost = brokerage_cost(fill * qty, costs) + fill * qty * costs.stt_pct / 100
        raw_pnl = (fill - entry_price) * qty if is_long else (entry_price - fill) * qty
        pnl = raw_pnl - entry_cost - exit_cost
        equity += pnl
        # Fold in whatever was already realized by a partial exit -- one
        # TradeRecord per logical position, with a blended exit price and a
        # combined reason, rather than two records that would otherwise
        # double-count "trades" in win-rate/expectancy stats.
        total_pnl = pnl + partial_pnl
        total_notional = fill * qty + partial_notional
        blended_exit_price = total_notional / original_qty if original_qty else fill
        pnl_pct = total_pnl / (entry_price * original_qty) * 100 if entry_price * original_qty else 0.0
        combined_reason = f"partial_target+{reason}" if partial_taken else reason
        assert entry_time is not None
        outcome.trades.append(
            TradeRecord(
                entry_time=entry_time,
                exit_time=candles[i].time,
                signal="BUY" if is_long else "SELL",
                entry_price=round(entry_price, 4),
                exit_price=round(blended_exit_price, 4),
                quantity=original_qty,
                pnl=round(total_pnl, 2),
                pnl_pct=round(pnl_pct, 2),
                exit_reason=combined_reason,
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
            elif p.partial_exit_enabled and not partial_taken and bar.high >= target_price:
                take_partial(i, target_price)
            elif not p.partial_exit_enabled and bar.high >= target_price:
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
            elif p.partial_exit_enabled and not partial_taken and bar.low <= target_price:
                take_partial(i, target_price)
            elif not p.partial_exit_enabled and bar.low <= target_price:
                close_position(i, target_price, "target")
            elif r is not None and r < p.oversold:
                close_position(i, bar.close, "signal")

        else:
            wants_long = r is not None and r < p.oversold
            wants_short = p.allow_short and r is not None and r > p.overbought
            if wants_long or wants_short:
                blocked_by_time = p.time_filter_enabled and is_near_eia_report(
                    bar.time, p.eia_window_before_minutes, p.eia_window_after_minutes
                )
                # Regime filter: ADX unavailable (warmup) is treated as "not
                # confirmed non-trending" -- i.e. blocks the entry, the same
                # conservative default the Volatility/Time filters use when
                # their own inputs aren't ready yet.
                blocked_by_regime = p.regime_filter_enabled and (
                    adx_vals[i] is None or adx_vals[i] >= p.regime_adx_max  # type: ignore[operator]
                )
                vol_state = _volatility_state(atr_vals[i], atr_avg_vals[i], p)
                if not blocked_by_time and not blocked_by_regime and vol_state != "skip":
                    stop_pct = p.stop_loss_pct * p.atr_widen_factor if vol_state == "widen" else p.stop_loss_pct
                    if wants_long:
                        open_long(i, stop_pct)
                    else:
                        open_short(i, stop_pct)

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
