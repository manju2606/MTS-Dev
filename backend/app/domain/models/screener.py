from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4

CRITERIA_FIELDS = [
    # Technical
    "rsi",
    "macd_hist",
    "sma20_ratio",
    "sma50_ratio",
    "volume_ratio",
    "change_pct",
    "atr_pct",
    # Fundamental (from yfinance info)
    "pe_ratio",
    "pb_ratio",
    "market_cap_cr",
    "dividend_yield",
    "roe",
    "debt_to_equity",
    "revenue_growth",
]

OPERATORS = ["<", ">", "<=", ">="]

UNIVERSES = ["nifty50", "nifty100", "niftymidcap150", "niftysmallcap250"]


@dataclass
class ScreenerCriterion:
    field: str
    operator: str
    value: float


@dataclass
class SavedScreen:
    user_id: str
    name: str
    universe: str
    criteria: list[ScreenerCriterion]
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
