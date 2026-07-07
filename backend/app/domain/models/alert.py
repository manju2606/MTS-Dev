from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class Alert:
    user_id: UUID
    symbol: str  # e.g. "RELIANCE.NS"
    price_target: float
    direction: str  # "above" | "below"
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
    triggered: bool = False
    triggered_at: datetime | None = None
    triggered_price: float | None = None
