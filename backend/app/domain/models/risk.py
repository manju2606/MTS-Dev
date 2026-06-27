from dataclasses import dataclass


@dataclass
class RiskConfig:
    capital: float = 100_000.0
    max_position_pct: float = 0.10    # max 10% per trade
    max_daily_loss_pct: float = 0.02  # 2% daily loss limit
    max_drawdown_pct: float = 0.10    # 10% drawdown triggers circuit breaker
    min_risk_reward: float = 1.5      # minimum reward-to-risk ratio
    max_stop_pct: float = 0.08        # max stop distance = 8% of entry


@dataclass
class RiskCheckResult:
    passed: bool
    violations: list[str]
    max_quantity: int | None = None  # suggested max qty given capital limits
