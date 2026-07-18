"""Walk-forward validation -- splits the candle series chronologically into
a train segment (first 70%) and an out-of-sample test segment (last 30%),
backtests the candidate independently on each, and scores how well the
test-segment performance held up relative to train. A strategy that only
"works" on the segment it was implicitly shaped against (the generator's
fixed templates aren't fit to this specific data, but this still catches
strategies that only work in one specific regime) scores low here and gets
penalized in ranking.py -- this is the single check standing in for the
full walk-forward *optimization* described in the original spec (which
would re-optimize parameters per fold; v1's candidates have fixed params,
so this is a stability check, not a re-fit).
"""

from __future__ import annotations

from app.domain.models.historical_candle import HistoricalCandle
from app.domain.models.strategy_lab import BacktestMetrics, StrategyCandidate, WalkForwardSplit
from app.domain.services.strategy_lab.engine import run_backtest
from app.domain.services.strategy_lab.metrics import compute_metrics

TRAIN_FRACTION = 0.7


def run_walk_forward(
    candles: list[HistoricalCandle], candidate: StrategyCandidate, capital: float
) -> WalkForwardSplit:
    split_idx = int(len(candles) * TRAIN_FRACTION)
    train_candles = candles[:split_idx]
    test_candles = candles[split_idx:]

    train_outcome = run_backtest(train_candles, candidate, capital)
    test_outcome = run_backtest(test_candles, candidate, capital)
    train_metrics = compute_metrics(train_outcome, capital)
    test_metrics = compute_metrics(test_outcome, capital)

    stability = _stability_score(train_metrics, test_metrics)
    return WalkForwardSplit(
        train_metrics=train_metrics, test_metrics=test_metrics, stability_score=stability
    )


def _stability_score(train: BacktestMetrics, test: BacktestMetrics) -> float:
    if test.total_trades == 0:
        return 0.0  # can't confirm it holds up out-of-sample at all

    if train.sharpe_ratio > 0:
        sharpe_retention = max(0.0, min(test.sharpe_ratio / train.sharpe_ratio, 1.0))
    else:
        sharpe_retention = 1.0 if test.sharpe_ratio >= 0 else 0.0

    dd_diff = abs(test.max_drawdown_pct - train.max_drawdown_pct)
    drawdown_consistency = max(0.0, 1 - dd_diff / max(train.max_drawdown_pct, 1.0))

    sign_agreement = 1.0 if (test.net_pnl > 0) == (train.net_pnl > 0) else 0.0

    score = 100 * (0.5 * sharpe_retention + 0.3 * drawdown_consistency + 0.2 * sign_agreement)
    return round(max(0.0, min(100.0, score)), 1)
