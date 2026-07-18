"""AI Strategy Lab domain models -- auto-generated, auto-backtested,
auto-ranked trading strategies over stored historical data (see
services/strategy_lab/ for the generation/backtest/ranking logic and
infra/db/repositories/strategy_lab_repo.py for persistence).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4


@dataclass
class StrategyCandidate:
    """One generated strategy definition -- a template family plus a
    specific parameter combination. Pure data, no behavior; engine.py
    interprets `entry_rule`/`exit_rule` against an indicator snapshot."""

    id: str
    name: str
    family: str  # e.g. "ema_crossover", "rsi_reversion", "supertrend"
    description: str
    params: dict[str, float | int]  # indicator periods/thresholds
    stop_loss_pct: float
    target_pct: float
    trailing_stop_pct: float | None
    position_size_pct: float  # % of capital risked per trade

    @staticmethod
    def new_id() -> str:
        return uuid4().hex[:12]


@dataclass
class TradeRecord:
    entry_time: datetime
    exit_time: datetime
    signal: str  # BUY | SELL
    entry_price: float
    exit_price: float
    quantity: int
    pnl: float
    pnl_pct: float
    exit_reason: str  # "target" | "stop_loss" | "trailing_stop" | "signal" | "eod"


@dataclass
class BacktestMetrics:
    total_trades: int
    win_rate_pct: float
    profit_factor: float
    expectancy: float  # average pnl per trade, in currency ("Average Trade")
    cagr_pct: float
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown_pct: float
    avg_holding_hours: float
    net_pnl: float
    final_equity: float
    # net_pnl / max drawdown (currency) -- how much profit per unit of worst
    # peak-to-trough loss. Defaulted (not required) so BacktestMetrics(**doc)
    # still reconstructs stored results saved before this field existed.
    recovery_factor: float = 0.0


@dataclass
class WalkForwardSplit:
    train_metrics: BacktestMetrics
    test_metrics: BacktestMetrics
    stability_score: float  # 0-100 -- how well test performance held up vs train


@dataclass
class StrategyLabResult:
    id: str
    run_id: str
    candidate: StrategyCandidate
    full_metrics: BacktestMetrics  # backtest over the entire requested range
    walk_forward: WalkForwardSplit
    composite_score: float  # 0-100 -- the AI ranking score (see ranking.py)
    equity_curve: list[dict]  # [{time, equity}]
    drawdown_curve: list[dict]  # [{time, drawdown_pct}]
    trades: list[TradeRecord]

    @staticmethod
    def new_id() -> str:
        return uuid4().hex[:12]


@dataclass
class IndexScanRun:
    """Runs the full auto-generated 392-candidate sweep (see generator.py)
    against every symbol in an index universe, one full StrategyLabRun per
    symbol -- child_run_ids maps symbol -> that run's id, so the existing
    run/result machinery (and UI) is reused unchanged per symbol. The
    "ranking" a caller wants (services/strategy_lab_service.get_index_scan_ranking)
    is computed on demand from each child run's own top result, not stored
    here -- this record only tracks progress through the symbol list."""

    id: str
    user_id: str
    index: str  # e.g. "NIFTY50"
    exchange: str
    interval: str
    from_date: str
    to_date: str
    capital: float
    status: str  # pending | running | completed | failed
    total_symbols: int = 0
    completed_symbols: int = 0
    child_run_ids: dict[str, str] = field(default_factory=dict)  # symbol -> StrategyLabRun.id
    failed_symbols: list[str] = field(default_factory=list)
    error: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None

    @staticmethod
    def new_id() -> str:
        return uuid4().hex[:12]


@dataclass
class StrategyLabRun:
    id: str
    user_id: str
    symbol: str
    exchange: str
    interval: str
    from_date: str
    to_date: str
    capital: float
    status: str  # pending | downloading | generating | running | completed | failed
    total_candidates: int = 0
    completed_candidates: int = 0
    error: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None
    # Denormalized from this run's own top-scoring StrategyLabResult once it
    # completes -- lets a flat run list (Past Runs, an Index Scan's 50 child
    # runs) show "which strategy was best for this symbol" without an N+1
    # results query per row. None until the run actually finishes.
    best_candidate_name: str | None = None
    best_composite_score: float | None = None

    @staticmethod
    def new_id() -> str:
        return uuid4().hex[:12]
