"""Unit tests for app/core/crypto.py -- the Fernet-based encrypt/decrypt
helper used to store Zerodha auto-login credentials at rest."""

import pytest
from cryptography.fernet import Fernet

from app.core import crypto


@pytest.fixture(autouse=True)
def _fresh_key(monkeypatch):
    """Each test gets its own key + a cleared lru_cache, so tests don't leak
    state into each other or depend on whatever ZERODHA_CREDS_ENCRYPTION_KEY
    happens to be set in the environment."""
    monkeypatch.setattr(crypto.settings, "ZERODHA_CREDS_ENCRYPTION_KEY", Fernet.generate_key().decode())
    crypto._fernet.cache_clear()
    yield
    crypto._fernet.cache_clear()


def test_encrypt_then_decrypt_round_trips():
    payload = {"kite_user_id": "AB1234", "password": "hunter2", "totp_secret": "JBSWY3DPEHPK3PXP"}
    token = crypto.encrypt_json(payload)
    assert token != str(payload)
    assert crypto.decrypt_json(token) == payload


def test_decrypt_with_wrong_key_raises():
    token = crypto.encrypt_json({"a": 1})
    # Swap in a different key without clearing correctly-encrypted data
    crypto.settings.ZERODHA_CREDS_ENCRYPTION_KEY = Fernet.generate_key().decode()
    crypto._fernet.cache_clear()
    with pytest.raises(crypto.CredentialEncryptionError):
        crypto.decrypt_json(token)


def test_missing_key_raises():
    crypto.settings.ZERODHA_CREDS_ENCRYPTION_KEY = None
    crypto._fernet.cache_clear()
    with pytest.raises(crypto.CredentialEncryptionError):
        crypto.encrypt_json({"a": 1})
