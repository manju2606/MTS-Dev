"""Tests for risk config GET and PATCH endpoints."""
from uuid import uuid4

import pytest
from httpx import AsyncClient

BASE_RISK = "/api/v1/risk"
BASE_AUTH = "/api/v1/auth"


def _email() -> str:
    return f"risk_{uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def token(client: AsyncClient) -> str:
    email, pw = _email(), "Secure123!"
    await client.post(f"{BASE_AUTH}/register", json={
        "email": email, "password": pw, "full_name": "Risk Tester",
    })
    login = await client.post(f"{BASE_AUTH}/login", json={"email": email, "password": pw})
    return login.json()["access_token"]


async def test_get_risk_config_defaults(client: AsyncClient, token: str):
    resp = await client.get(f"{BASE_RISK}/config", headers=_headers(token))
    assert resp.status_code == 200
    body = resp.json()
    assert "capital" in body
    assert "max_position_pct" in body
    assert "min_risk_reward" in body
    assert body["capital"] > 0


async def test_patch_risk_config(client: AsyncClient, token: str):
    resp = await client.patch(
        f"{BASE_RISK}/config",
        headers=_headers(token),
        json={"capital": 200000.0, "min_risk_reward": 2.0},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["capital"] == 200000.0
    assert body["min_risk_reward"] == 2.0

    # Verify GET now returns updated values
    get = await client.get(f"{BASE_RISK}/config", headers=_headers(token))
    assert get.json()["capital"] == 200000.0


async def test_patch_risk_config_invalid(client: AsyncClient, token: str):
    # capital must be > 0
    resp = await client.patch(
        f"{BASE_RISK}/config",
        headers=_headers(token),
        json={"capital": -1000},
    )
    assert resp.status_code == 422


async def test_risk_status(client: AsyncClient, token: str):
    resp = await client.get(f"{BASE_RISK}/status", headers=_headers(token))
    assert resp.status_code == 200
    body = resp.json()
    assert "open_trades" in body
    assert "daily_pnl" in body


async def test_risk_config_unauthenticated(client: AsyncClient):
    resp = await client.get(f"{BASE_RISK}/config")
    assert resp.status_code == 403
