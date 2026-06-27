from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4

PLAN_LIMITS: dict[str, dict] = {
    "free":       {"max_users": 1,  "max_capital": 100_000,    "live_trading": False},
    "pro":        {"max_users": 5,  "max_capital": 1_000_000,  "live_trading": True},
    "enterprise": {"max_users": -1, "max_capital": -1,         "live_trading": True},
}


@dataclass
class Organization:
    name: str
    plan: str = "free"     # free | pro | enterprise
    id: UUID = field(default_factory=uuid4)
    is_active: bool = True
    created_at: datetime = field(default_factory=datetime.utcnow)

    @property
    def limits(self) -> dict:
        return PLAN_LIMITS.get(self.plan, PLAN_LIMITS["free"])
