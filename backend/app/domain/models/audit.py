from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class AuditEvent:
    user_id: str
    action: str  # e.g. "trade.create", "login", "risk.update"
    resource: str  # e.g. "trade:uuid" or "" for session actions
    details: dict  # arbitrary context dict
    ip: str = ""
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
