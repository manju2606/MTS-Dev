"""Risk configuration and derived daily state for the MTS Silver Strategy --
see app/domain/services/mcx_silver_risk_gate.py for the enforcement logic
that consumes these.

Unlike RiskConfig/RiskEngine (app/domain/models/risk.py), which validates a
trade's own SL/target/quantity after the caller has already sized it,
SilverDailyState is derived fresh each check from actual closed-signal
history (see McxSignalRepository.list_user_closed_signals_since) rather than
a separately persisted, incrementable counter -- there is nothing to reset
at market open and nothing that can drift out of sync with what actually
happened, since it's recomputed from the source of truth every time.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SilverRiskConfig:
    """Every numeric control the spec's Risk Management/Position
    Sizing/Trading Session/Expiry Protection sections call for. Defaults
    match the spec's own defaults."""

    capital: float = 100_000.0
    risk_per_trade_pct: float = 0.5
    max_daily_loss_pct: float = 2.0
    max_trades_per_day: int = 3
    max_consecutive_losses: int = 2
    session_start: str = "09:00"
    session_end: str = "23:30"
    avoid_first_minutes: int = 15
    avoid_last_minutes: int = 15
    days_before_expiry_stop: int = 5


@dataclass(frozen=True)
class SilverDailyState:
    """Derived, not stored -- see module docstring."""

    trade_count: int
    realized_pnl: float
    consecutive_losses: int


@dataclass(frozen=True)
class SilverRiskCheckResult:
    can_trade: bool
    reasons: list[str]  # empty when can_trade is True
