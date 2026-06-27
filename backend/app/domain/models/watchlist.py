from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class WatchlistItem:
    user_id: UUID
    symbol: str    # e.g. "RELIANCE.NS"
    exchange: str  # "NSE" or "BSE"
    id: UUID = field(default_factory=uuid4)
    added_at: datetime = field(default_factory=datetime.utcnow)
