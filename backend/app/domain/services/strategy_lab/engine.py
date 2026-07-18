"""Event-driven single-position backtest engine. Every strategy family
produces a per-bar (entry_signal, exit_signal) boolean pair from its
indicator series (see _signals_for below); the position-management loop
itself is family-agnostic and always applies stop-loss/target/trailing-stop
against each bar's actual high/low (not just the close), plus realistic
transaction costs on every fill.

Long-only for v1 -- shorting doubles the family-signal logic and most of
the value (finding a working long strategy per symbol) doesn't need it yet.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from app.domain.models.historical_candle import HistoricalCandle
from app.domain.models.strategy_lab import StrategyCandidate, TradeRecord
from app.domain.services.strategy_lab import indicators as ind


@dataclass
class TransactionCosts:
    """Matches real Indian discount-broker F&O/commodity pricing (e.g.
    Zerodha): brokerage is a FLAT fee per executed order, or a % of
    turnover, whichever is LOWER -- never pure percentage. This matters a
    lot for tight-stop/high-leverage strategies (ATR-based futures stops
    especially): a percentage-only model scales cost with notional
    exposure without bound, so a 30x-leveraged position (routine for a
    tight ATR stop) gets charged as if it were a 30x larger trade than it
    actually risks -- costs alone can exceed the entire risk budget. See
    trend_pullback.py's conversation history for the concrete case that
    surfaced this."""

    brokerage_flat: float = 20.0  # rupees per executed order
    brokerage_pct: float = 0.03  # % of turnover, per side -- whichever is lower than flat
    stt_pct: float = 0.01  # commodity transaction tax, sell side only
    slippage_pct: float = 0.05  # per side


def brokerage_cost(turnover: float, costs: TransactionCosts) -> float:
    return min(costs.brokerage_flat, turnover * costs.brokerage_pct / 100)


# Real MCX/NSE F&O margin requirements (SPAN + exposure) generally work out
# to needing roughly 5-15% of notional as margin -- i.e. a realistic
# leverage ceiling of about 7-20x depending on the instrument's volatility.
# A tight ATR-based stop can otherwise imply 30x+ leverage that no broker
# would actually extend; this caps position sizing at whichever is smaller,
# the risk-based quantity or this leverage ceiling.
MAX_LEVERAGE = 10.0


def capped_quantity(risk_amount: float, stop_distance: float, price: float, equity: float) -> int:
    if stop_distance <= 0 or price <= 0:
        return 0
    risk_based = risk_amount / stop_distance
    leverage_based = (equity * MAX_LEVERAGE) / price
    return max(0, int(min(risk_based, leverage_based)))


@dataclass
class BacktestOutcome:
    trades: list[TradeRecord] = field(default_factory=list)
    equity_curve: list[dict] = field(default_factory=list)  # [{time, equity}]
    final_equity: float = 0.0


def _crosses_above(a: list[float | None], b: list[float | None], i: int) -> bool:
    if i == 0 or a[i] is None or b[i] is None or a[i - 1] is None or b[i - 1] is None:
        return False
    return a[i - 1] <= b[i - 1] and a[i] > b[i]  # type: ignore[operator]


def _crosses_below(a: list[float | None], b: list[float | None], i: int) -> bool:
    if i == 0 or a[i] is None or b[i] is None or a[i - 1] is None or b[i - 1] is None:
        return False
    return a[i - 1] >= b[i - 1] and a[i] < b[i]  # type: ignore[operator]


def _signals_for(
    family: str, params: dict, highs: list[float], lows: list[float], closes: list[float]
) -> tuple[list[bool], list[bool]]:
    """Returns (entry_signal, exit_signal) -- both length-n booleans. exit_signal
    is the family's own reversal/exhaustion signal; stop-loss/target/trailing
    are handled separately by the position-management loop regardless of family."""
    n = len(closes)
    entry = [False] * n
    exit_ = [False] * n

    if family == "ema_crossover":
        fast = ind.ema(closes, int(params["fast"]))
        slow = ind.ema(closes, int(params["slow"]))
        for i in range(1, n):
            entry[i] = fast[i - 1] <= slow[i - 1] and fast[i] > slow[i]
            exit_[i] = fast[i - 1] >= slow[i - 1] and fast[i] < slow[i]

    elif family == "rsi_reversion":
        rsi_vals = ind.rsi(closes, int(params["period"]))
        oversold, overbought = params["oversold"], params["overbought"]
        for i in range(n):
            r = rsi_vals[i]
            if r is None:
                continue
            entry[i] = r < oversold
            exit_[i] = r > overbought

    elif family == "macd_crossover":
        macd_line, signal_line, _ = ind.macd(
            closes, int(params["fast"]), int(params["slow"]), int(params["signal"])
        )
        macd_series: list[float | None] = list(macd_line)
        signal_series: list[float | None] = list(signal_line)
        for i in range(1, n):
            entry[i] = _crosses_above(macd_series, signal_series, i)
            exit_[i] = _crosses_below(macd_series, signal_series, i)

    elif family == "bollinger_breakout":
        bb_mid, bb_upper, _ = ind.bollinger(closes, int(params["period"]), float(params["num_std"]))
        for i in range(1, n):
            u, u_prev, m = bb_upper[i], bb_upper[i - 1], bb_mid[i]
            if u is None or u_prev is None:
                continue
            entry[i] = closes[i - 1] <= u_prev and closes[i] > u
            exit_[i] = m is not None and closes[i] < m

    elif family == "bollinger_reversion":
        bb_mid2, _, bb_lower = ind.bollinger(
            closes, int(params["period"]), float(params["num_std"])
        )
        for i in range(n):
            lo, m = bb_lower[i], bb_mid2[i]
            entry[i] = lo is not None and closes[i] < lo
            exit_[i] = m is not None and closes[i] > m

    elif family == "supertrend":
        _, direction = ind.supertrend(
            highs, lows, closes, int(params["period"]), float(params["multiplier"])
        )
        for i in range(1, n):
            entry[i] = direction[i - 1] != 1 and direction[i] == 1
            exit_[i] = direction[i - 1] == 1 and direction[i] != 1

    elif family == "donchian_breakout":
        dc_upper, _, dc_mid = ind.donchian(highs, lows, int(params["period"]))
        for i in range(1, n):
            u_prev, m = dc_upper[i - 1], dc_mid[i]
            entry[i] = u_prev is not None and closes[i] > u_prev
            exit_[i] = m is not None and closes[i] < m

    elif family == "cci_reversion":
        cci_vals = ind.cci(highs, lows, closes, int(params["period"]))
        band = params["band"]
        for i in range(n):
            c = cci_vals[i]
            if c is None:
                continue
            entry[i] = c < -band
            exit_[i] = c > band

    elif family == "keltner_breakout":
        kc_mid, kc_upper, _ = ind.keltner(
            highs, lows, closes, int(params["period"]), float(params["atr_mult"])
        )
        for i in range(1, n):
            u_prev = kc_upper[i - 1]
            entry[i] = u_prev is not None and closes[i] > u_prev
            exit_[i] = closes[i] < kc_mid[i]

    elif family == "stochastic_reversion":
        k_vals, _ = ind.stochastic(
            highs, lows, closes, int(params["k_period"]), int(params["d_period"])
        )
        oversold, overbought = params["oversold"], params["overbought"]
        for i in range(1, n):
            k_now, k_prev = k_vals[i], k_vals[i - 1]
            if k_now is None or k_prev is None:
                continue
            entry[i] = k_prev < oversold <= k_now
            exit_[i] = k_prev > overbought >= k_now

    else:
        raise ValueError(f"Unknown strategy family '{family}'")

    return entry, exit_


def run_backtest(
    candles: list[HistoricalCandle],
    candidate: StrategyCandidate,
    capital: float,
    costs: TransactionCosts | None = None,
) -> BacktestOutcome:
    costs = costs or TransactionCosts()
    n = len(candles)
    outcome = BacktestOutcome(final_equity=capital)
    if n < 30:
        return outcome

    closes = [c.close for c in candles]
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    entry_signal, exit_signal = _signals_for(
        candidate.family, candidate.params, highs, lows, closes
    )

    equity = capital
    in_position = False
    entry_price = 0.0
    entry_time: datetime | None = None
    qty = 0
    stop_price = 0.0
    target_price = 0.0
    trail_price: float | None = None

    outcome.equity_curve.append({"time": candles[0].time.isoformat(), "equity": round(equity, 2)})

    def open_position(i: int) -> None:
        nonlocal in_position, entry_price, entry_time, qty, stop_price, target_price, trail_price
        fill = candles[i].close * (1 + costs.slippage_pct / 100)
        risk_amount = equity * candidate.position_size_pct / 100
        stop_distance = fill * candidate.stop_loss_pct / 100
        q = capped_quantity(risk_amount, stop_distance, fill, equity)
        if q == 0:
            return
        in_position = True
        entry_price = fill
        entry_time = candles[i].time
        qty = q
        stop_price = fill * (1 - candidate.stop_loss_pct / 100)
        target_price = fill * (1 + candidate.target_pct / 100)
        trail_price = None

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

    for i in range(1, n):
        bar = candles[i]

        if in_position:
            if candidate.trailing_stop_pct is not None:
                candidate_trail = bar.close * (1 - candidate.trailing_stop_pct / 100)
                trail_price = (
                    candidate_trail if trail_price is None else max(trail_price, candidate_trail)
                )
                effective_stop = max(stop_price, trail_price)
            else:
                effective_stop = stop_price

            if bar.low <= effective_stop:
                close_position(
                    i,
                    effective_stop,
                    "trailing_stop"
                    if trail_price and effective_stop == trail_price
                    else "stop_loss",
                )
            elif bar.high >= target_price:
                close_position(i, target_price, "target")
            elif exit_signal[i]:
                close_position(i, bar.close, "signal")
        elif entry_signal[i]:
            open_position(i)

        if i % 5 == 0 or i == n - 1:
            mtm = equity + (bar.close - entry_price) * qty if in_position else equity
            outcome.equity_curve.append({"time": bar.time.isoformat(), "equity": round(mtm, 2)})

    if in_position:
        close_position(n - 1, candles[-1].close, "eod")
        outcome.equity_curve.append(
            {"time": candles[-1].time.isoformat(), "equity": round(equity, 2)}
        )

    outcome.final_equity = equity
    return outcome
