"""Domain model for Stock of the Day recommendation."""

from dataclasses import dataclass, field


@dataclass
class StockOfDay:
    date: str  # YYYY-MM-DD (IST)
    generated_at: str  # ISO UTC datetime
    symbol: str
    name: str
    sector: str

    # Multi-source scoring
    discovery_score: float  # 0-100 from ML discovery engine
    discovery_signal: str  # STRONG_BUY / BUY / etc
    scanner_hits: list[str]  # scan IDs that matched (momentum, high_volume_breakout…)
    forecast_direction: str  # UP / DOWN / FLAT / N/A

    # Composite score: discovery + scanner bonus + signal bonus
    composite_score: float  # 0-100
    confidence: float  # 0.0-1.0

    # Trade parameters (sourced from discovery engine)
    entry_price: float
    stop_loss: float
    target: float
    risk_reward: float
    holding_period: str
    explanation: str

    # Auto-trade state (placed automatically when composite_score >= AUTO_TRADE_THRESHOLD)
    auto_traded: bool = False
    paper_trade_id: str | None = None
    auto_trade_user_id: str | None = None
    quantity: int = 1

    # Lifecycle status
    # WATCHING  → generated but not auto-traded (confidence < threshold)
    # TRADING   → auto-trade placed, monitoring SL/target
    # TARGET_HIT → target reached, booked profit
    # STOP_HIT  → stop loss triggered, booked loss
    # EXPIRED   → market closed without trigger, closed at CMP
    status: str = "WATCHING"
    exit_price: float | None = None
    exit_time: str | None = None
    pnl_pct: float | None = None
    outcome: str | None = None  # WIN / LOSS / NEUTRAL

    id: str | None = field(default=None, compare=False)


AUTO_TRADE_THRESHOLD = 85.0  # composite_score >= this → place paper trade


@dataclass
class SotDSettings:
    """Admin-configurable rules for the Stock-of-the-Day auto-trade engine."""

    auto_trade_enabled: bool = True
    threshold: float = 85.0  # composite_score must be >= this to auto-trade
    max_daily_trades: int = 1  # hard cap: at most N auto-trades per calendar day
    market_hours_only: bool = True  # reject auto-trade if NSE is not open (9:15–15:30 IST weekdays)
    paper_trade_quantity: float = 1.0  # qty value — interpretation depends on quantity_type
    quantity_type: str = "qty"  # "qty" = fixed shares | "pct" = % of paper_capital
    paper_capital: float = 100000.0  # virtual capital base (INR) used when quantity_type="pct"
