from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4

NOTIFICATION_TYPES = [
    "alert.triggered",
    "trade.executed",
    "signal.generated",
    "strategy.condition_met",
    "risk.limit_breached",
    "system.info",
]


@dataclass
class Notification:
    user_id: str
    type: str
    title: str
    body: str
    link: str = ""
    read: bool = False
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
