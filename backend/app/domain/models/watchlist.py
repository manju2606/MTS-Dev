from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class Watchlist:
    user_id: UUID
    name: str
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class WatchlistItem:
    user_id: UUID
    symbol: str  # e.g. "RELIANCE.NS"
    exchange: str  # "NSE" or "BSE"
    watchlist_id: UUID | None = None  # None only for legacy rows
    id: UUID = field(default_factory=uuid4)
    added_at: datetime = field(default_factory=datetime.utcnow)
