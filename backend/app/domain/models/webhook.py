from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4

WEBHOOK_EVENTS = [
    "alert.triggered",
    "signal.generated",
    "trade.executed",
    "discovery.scan_complete",
    "position.stop_hit",
    "position.target_hit",
]


@dataclass
class WebhookSubscription:
    user_id: str
    url: str
    events: list[str]
    secret: str
    name: str = ""
    id: UUID = field(default_factory=uuid4)
    is_active: bool = True
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_triggered_at: datetime | None = None
    failure_count: int = 0
