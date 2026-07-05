from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


INDICATORS = ["rsi", "macd", "macd_hist", "sma20_ratio", "sma50_ratio",
              "bb_position", "atr_pct", "vol_ratio", "price", "volume"]

OPERATORS = ["<", ">", "<=", ">=", "==", "crosses_above", "crosses_below"]


@dataclass
class StrategyCondition:
    indicator: str    # one of INDICATORS
    operator: str     # one of OPERATORS
    value: float


@dataclass
class Strategy:
    name: str
    user_id: str
    action: str                             # BUY | SELL
    conditions: list[StrategyCondition]
    description: str = ""
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
    is_active: bool = True
