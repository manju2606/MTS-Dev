from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4


class TradeSignal(StrEnum):
    BUY = "BUY"
    SELL = "SELL"


class TradeStatus(StrEnum):
    PENDING = "pending"
    OPEN = "open"
    CLOSED = "closed"
    CANCELLED = "cancelled"


class TradeMode(StrEnum):
    PAPER = "paper"
    LIVE = "live"


@dataclass
class Trade:
    user_id: UUID
    symbol: str         # e.g. "RELIANCE.NS"
    exchange: str       # "NSE" or "BSE"
    signal: TradeSignal
    entry_price: float
    stop_loss: float
    target: float
    quantity: int
    mode: TradeMode = TradeMode.PAPER
    status: TradeStatus = TradeStatus.PENDING
    id: UUID = field(default_factory=uuid4)
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    exit_price: float | None = None
    ai_confidence: float | None = None
    ai_explanation: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)

    @property
    def risk_reward_ratio(self) -> float:
        risk = abs(self.entry_price - self.stop_loss)
        reward = abs(self.target - self.entry_price)
        return round(reward / risk, 2) if risk > 0 else 0.0
