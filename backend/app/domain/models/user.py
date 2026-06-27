from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4


class UserRole(StrEnum):
    ADMIN = "admin"
    TRADER = "trader"
    VIEWER = "viewer"


@dataclass
class User:
    email: str
    hashed_password: str
    full_name: str
    role: UserRole = UserRole.TRADER
    is_active: bool = True
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
