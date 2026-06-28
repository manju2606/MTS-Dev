from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class AISignal:
    user_id: UUID
    symbol: str
    signal: str
    confidence: float
    entry_price: float
    stop_loss: float
    target: float
    risk_reward_ratio: float
    holding_period: str
    explanation: str
    engine: str
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
