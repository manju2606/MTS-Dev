"""Symmetric encryption for credentials that must be recovered in plaintext
later -- unlike password hashing (core/security.py's bcrypt, one-way), this
is reversible by design: the Zerodha TOTP auto-login job needs the user's
actual password and TOTP secret in plaintext each morning to replay Kite's
login flow (see app/infra/brokers/zerodha_autologin.py).

Uses Fernet (AES-128-CBC + HMAC-SHA256, from the `cryptography` package).
Key comes from settings.ZERODHA_CREDS_ENCRYPTION_KEY -- a 32-byte
urlsafe-base64 key. Generate one with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Losing this key makes every stored credential permanently undecryptable --
there is no recovery path, by design (same tradeoff as SECRET_KEY).
"""

from __future__ import annotations

import json
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class CredentialEncryptionError(Exception):
    """Raised when ZERODHA_CREDS_ENCRYPTION_KEY is missing/invalid, or a
    stored payload can't be decrypted with the configured key (wrong key,
    corrupted data, or the key rotated without re-encrypting old rows)."""


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = settings.ZERODHA_CREDS_ENCRYPTION_KEY
    if not key:
        raise CredentialEncryptionError(
            "ZERODHA_CREDS_ENCRYPTION_KEY not configured -- required to store or "
            "read Zerodha auto-login credentials. Generate one with: "
            'python -c "from cryptography.fernet import Fernet; '
            'print(Fernet.generate_key().decode())"'
        )
    try:
        return Fernet(key.encode())
    except ValueError as exc:
        raise CredentialEncryptionError(
            "ZERODHA_CREDS_ENCRYPTION_KEY is not a valid Fernet key"
        ) from exc


def encrypt_json(payload: dict) -> str:
    return _fernet().encrypt(json.dumps(payload).encode()).decode()


def decrypt_json(token: str) -> dict:
    try:
        raw = _fernet().decrypt(token.encode())
    except InvalidToken as exc:
        raise CredentialEncryptionError(
            "Failed to decrypt stored credentials -- wrong "
            "ZERODHA_CREDS_ENCRYPTION_KEY or corrupted data"
        ) from exc
    result: dict = json.loads(raw.decode())
    return result
