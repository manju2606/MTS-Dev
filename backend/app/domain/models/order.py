from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class LiveOrder:
    user_id: UUID
    symbol: str
    exchange: str
    signal: str  # BUY | SELL
    quantity: int
    order_type: str  # MARKET | LIMIT
    broker: str  # zerodha | simulated
    id: UUID = field(default_factory=uuid4)
    price: float | None = None
    broker_order_id: str | None = None
    status: str = "pending"  # pending | open | filled | cancelled | rejected
    fill_price: float | None = None
    fill_time: datetime | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
