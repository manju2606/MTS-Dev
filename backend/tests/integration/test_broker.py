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
