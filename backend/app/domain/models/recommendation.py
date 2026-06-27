from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class AIRecommendation:
    symbol: str
    signal: str        # BUY | SELL | HOLD
    confidence: float  # 0.0–1.0
    entry_price: float
    stop_loss: float
    target: float
    risk_reward_ratio: float
    holding_period: str  # e.g. "3–5 days"
    explanation: str
    id: UUID = field(default_factory=uuid4)
    generated_at: datetime = field(default_factory=datetime.utcnow)
