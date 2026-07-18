"""Backtest performance metrics -- pure functions over a BacktestOutcome's
trades + equity curve. Sharpe/Sortino are computed from trade-level percent
returns (annualized by sqrt(252)), matching the convention already used in
domain/services/backtester.py, rather than resampling the equity curve --
consistent with the existing simpler backtester and avoids needing to know
the bar interval to pick an annualization factor.
"""

from __future__ import annotations

from datetime import datetime

from app.domain.models.strategy_lab import BacktestMetrics, TradeRecord
from app.domain.services.strategy_lab.engine import BacktestOutcome


def _max_drawdown_pct(equity_curve: list[dict]) -> float:
    if not equity_curve:
        return 0.0
    peak = equity_curve[0]["equity"]
    max_dd = 0.0
    for point in equity_curve:
        peak = max(peak, point["equity"])
        if peak > 0:
            dd = (peak - point["equity"]) / peak * 100
            max_dd = max(max_dd, dd)
    return round(max_dd, 2)


def _cagr_pct(capital: float, final_equity: float, equity_curve: list[dict]) -> float:
    """Annualizes over the full backtest period (first to last equity-curve
    point, which always spans the whole requested date range -- see
    engine.py's run_backtest, which appends an equity point at candles[0]
    and candles[-1] regardless of how many trades actually fired) rather
    than the span between the first and last TRADE. Using the trade span
    blows up for a strategy with few, sparse trades: e.g. two trades a day
    apart inside a 2-year backtest annualizes a small real return over
    `1/365` of a year, producing something like a 9-digit "CAGR" that's a
    pure artifact of the tiny denominator, not a real number anyone should
    read as "9 crore % a year". Requiring at least ~30 days of real
    elapsed backtest time keeps the same guard against a near-zero
    denominator, just against the right timeframe."""
    if capital <= 0 or final_equity <= 0 or len(equity_curve) < 2:
        return 0.0
    start = datetime.fromisoformat(equity_curve[0]["time"])
    end = datetime.fromisoformat(equity_curve[-1]["time"])
    days = (end - start).days
    if days < 30:
        return 0.0
    years = days / 365.0
    growth: float = (final_equity / capital) ** (1 / years)
    return round((growth - 1) * 100, 2)


def _sharpe_and_sortino(trades: list[TradeRecord]) -> tuple[float, float]:
    if len(trades) < 2:
        return 0.0, 0.0
    returns = [t.pnl_pct for t in trades]
    avg_r = sum(returns) / len(returns)
    std_r = (sum((r - avg_r) ** 2 for r in returns) / len(returns)) ** 0.5
    sharpe = round(avg_r / std_r * (252**0.5) / 100, 2) if std_r > 0 else 0.0

    downside = [r for r in returns if r < 0]
    down_std = (sum(r**2 for r in downside) / len(downside)) ** 0.5 if downside else 0.0
    sortino = round(avg_r / down_std * (252**0.5) / 100, 2) if down_std > 0 else 0.0
    return sharpe, sortino


def compute_metrics(outcome: BacktestOutcome, capital: float) -> BacktestMetrics:
    trades = outcome.trades
    total = len(trades)
    if total == 0:
        return BacktestMetrics(
            total_trades=0,
            win_rate_pct=0.0,
            profit_factor=0.0,
            expectancy=0.0,
            cagr_pct=0.0,
            sharpe_ratio=0.0,
            sortino_ratio=0.0,
            max_drawdown_pct=0.0,
            avg_holding_hours=0.0,
            net_pnl=0.0,
            final_equity=outcome.final_equity,
        )

    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    win_rate = round(len(wins) / total * 100, 2)

    gross_profit = sum(t.pnl for t in wins)
    gross_loss = abs(sum(t.pnl for t in losses))
    profit_factor = (
        round(gross_profit / gross_loss, 2) if gross_loss > 0 else round(gross_profit, 2)
    )

    expectancy = round(sum(t.pnl for t in trades) / total, 2)
    avg_holding_hours = round(
        sum((t.exit_time - t.entry_time).total_seconds() / 3600 for t in trades) / total, 1
    )

    sharpe, sortino = _sharpe_and_sortino(trades)

    return BacktestMetrics(
        total_trades=total,
        win_rate_pct=win_rate,
        profit_factor=profit_factor,
        expectancy=expectancy,
        cagr_pct=_cagr_pct(capital, outcome.final_equity, outcome.equity_curve),
        sharpe_ratio=sharpe,
        sortino_ratio=sortino,
        max_drawdown_pct=_max_drawdown_pct(outcome.equity_curve),
        avg_holding_hours=avg_holding_hours,
        net_pnl=round(outcome.final_equity - capital, 2),
        final_equity=round(outcome.final_equity, 2),
    )


def drawdown_curve(equity_curve: list[dict]) -> list[dict]:
    if not equity_curve:
        return []
    peak = equity_curve[0]["equity"]
    out = []
    for point in equity_curve:
        peak = max(peak, point["equity"])
        dd = (peak - point["equity"]) / peak * 100 if peak > 0 else 0.0
        out.append({"time": point["time"], "drawdown_pct": round(dd, 2)})
    return out
