from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class ZerodhaAutoLoginCredential:
    """A user's Zerodha web-login credentials (Kite user ID, password, TOTP
    secret), held in plaintext only in memory -- persisted encrypted via
    SQLZerodhaAutoLoginRepository (see app/core/crypto.py). Used by the
    scheduled auto-login job (app/infra/brokers/zerodha_autologin.py) to
    replay Kite's own login flow each morning without a manual click-through.
    """

    user_id: UUID
    kite_user_id: str
    password: str
    totp_secret: str
    id: UUID = field(default_factory=uuid4)
    enabled: bool = True
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    last_auto_login_at: datetime | None = None
    last_auto_login_ok: bool | None = None
