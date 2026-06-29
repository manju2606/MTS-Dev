from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class ApiKey:
    user_id: UUID
    name: str
    key_hash: str       # SHA-256 of the raw key (never stored in plaintext)
    key_prefix: str     # first 8 hex chars shown in listings for identification
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_used_at: datetime | None = None
    revoked: bool = False
