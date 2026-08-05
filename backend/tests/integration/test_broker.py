"""Integration tests for broker management endpoints."""

import uuid

import pytest
from httpx import AsyncClient

BASE = "/api/v1/broker"
AUTH = "/api/v1/auth"


def _email() -> str:
    return f"broker_{uuid.uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def token(client: AsyncClient) -> str:
    email, pw = _email(), "Secure123!"
    await client.post(AUTH + "/register", json={"email": email, "password": pw, "full_name": "BK"})
    r = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


async def test_broker_status_default(client: AsyncClient, token: str) -> None:
    r = await client.get(BASE + "/status", headers=_headers(token))
    assert r.status_code == 200
    body = r.json()
    assert "broker" in body
    assert "connected" in body
    # Fresh user has no broker set → simulated by default
    assert body["broker"] == "simulated"
    assert body["connected"] is True


async def test_use_simulated(client: AsyncClient, token: str) -> None:
    r = await client.post(BASE + "/use-simulated", headers=_headers(token))
    assert r.status_code == 200
    body = r.json()
    assert body["broker"] == "simulated"
    assert body["connected"] is True


async def test_disconnect(client: AsyncClient, token: str) -> None:
    # Set simulated first, then disconnect
    await client.post(BASE + "/use-simulated", headers=_headers(token))
    r = await client.post(BASE + "/disconnect", headers=_headers(token))
    assert r.status_code == 200
    body = r.json()
    assert body["broker"] == "simulated"
    assert body["connected"] is True


async def test_disconnect_then_status(client: AsyncClient, token: str) -> None:
    await client.post(BASE + "/disconnect", headers=_headers(token))
    r = await client.get(BASE + "/status", headers=_headers(token))
    assert r.status_code == 200
    # After disconnect, fallback is simulated
    assert r.json()["connected"] is True


async def test_zerodha_login_url_no_key(client: AsyncClient, token: str) -> None:
    # When KITE_API_KEY is not configured, expect 503
    r = await client.get(BASE + "/zerodha/login-url", headers=_headers(token))
    # Either 503 (not configured) or 200 if key happens to be set in test env
    assert r.status_code in (200, 503)


async def test_zerodha_connect_no_key(client: AsyncClient, token: str) -> None:
    r = await client.post(
        BASE + "/zerodha/connect",
        json={"request_token": "fake_token"},
        headers=_headers(token),
    )
    # 503 when credentials not configured
    assert r.status_code in (400, 503)


async def test_broker_unauthenticated(client: AsyncClient) -> None:
    r = await client.get(BASE + "/status")
    assert r.status_code in (401, 403)


# ── Zerodha auto-login ──────────────────────────────────────────────────────


async def test_zerodha_auto_login_status_unconfigured(client: AsyncClient, token: str) -> None:
    r = await client.get(BASE + "/zerodha/auto-login", headers=_headers(token))
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is False
    assert body["enabled"] is False


async def test_zerodha_auto_login_save_requires_encryption_key(
    client: AsyncClient, token: str
) -> None:
    r = await client.post(
        BASE + "/zerodha/auto-login",
        json={"kite_user_id": "AB1234", "password": "secret", "totp_secret": "JBSWY3DPEHPK3PXP"},
        headers=_headers(token),
    )
    # 503 when ZERODHA_CREDS_ENCRYPTION_KEY isn't configured in the test env,
    # 200 if it happens to be set -- either way the endpoint must not 500.
    assert r.status_code in (200, 503)


async def test_zerodha_auto_login_test_no_saved_credentials(
    client: AsyncClient, token: str
) -> None:
    r = await client.post(BASE + "/zerodha/auto-login/test", headers=_headers(token))
    # 404 (no saved credentials) or 503 (KITE_API_KEY unset) -- either is a
    # correctly-handled "not ready" response, never a 500.
    assert r.status_code in (404, 503)


async def test_zerodha_auto_login_delete_when_none_saved(client: AsyncClient, token: str) -> None:
    r = await client.delete(BASE + "/zerodha/auto-login", headers=_headers(token))
    assert r.status_code == 200
    assert r.json()["configured"] is False


async def test_zerodha_auto_login_unauthenticated(client: AsyncClient) -> None:
    r = await client.get(BASE + "/zerodha/auto-login")
    assert r.status_code in (401, 403)
