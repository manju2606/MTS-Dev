"""Composite 0-100 AI ranking score -- a genuine weighted formula over
normalized metrics, not a marketing number. Weights sum to 1.0:

  CAGR              20%   -- raw return
  Sharpe            20%   -- risk-adjusted return
  Sortino           10%   -- downside-adjusted return
  Profit factor     15%   -- gross win / gross loss
  Max drawdown      15%   -- capital preservation (inverted: less DD = better)
  Expectancy         5%   -- average currency edge per trade
  Walk-forward       15%   -- out-of-sample stability (walk_forward.py)

A strategy with too few trades to be statistically meaningful (<10 over the
requested range) has its score capped, regardless of how good the numbers
look -- a handful of lucky trades isn't a strategy.
"""

from __future__ import annotations

from app.domain.models.strategy_lab import BacktestMetrics, WalkForwardSplit

MIN_RELIABLE_TRADES = 10
LOW_TRADE_COUNT_CAP = 40.0


def _normalize(value: float, lo: float, hi: float) -> float:
    if hi == lo:
        return 50.0
    return max(0.0, min(1.0, (value - lo) / (hi - lo))) * 100


def composite_score(metrics: BacktestMetrics, walk_forward: WalkForwardSplit) -> float:
    norm_cagr = _normalize(metrics.cagr_pct, -20, 60)
    norm_sharpe = _normalize(metrics.sharpe_ratio, -1, 3)
    norm_sortino = _normalize(metrics.sortino_ratio, -1, 4)
    norm_profit_factor = _normalize(min(metrics.profit_factor, 5.0), 0.5, 3.0)
    norm_drawdown = _normalize(-metrics.max_drawdown_pct, -40, 0)
    norm_expectancy = _normalize(metrics.expectancy, -500, 2000)

    score = (
        0.20 * norm_cagr
        + 0.20 * norm_sharpe
        + 0.10 * norm_sortino
        + 0.15 * norm_profit_factor
        + 0.15 * norm_drawdown
        + 0.05 * norm_expectancy
        + 0.15 * walk_forward.stability_score
    )

    if metrics.total_trades < MIN_RELIABLE_TRADES:
        score = min(score, LOW_TRADE_COUNT_CAP)

    return round(max(0.0, min(100.0, score)), 1)
