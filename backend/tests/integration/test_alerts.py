"""Tests for price alerts endpoints."""
from uuid import uuid4

import pytest
from httpx import AsyncClient

BASE_ALERTS = "/api/v1/alerts"
BASE_AUTH = "/api/v1/auth"


def _email() -> str:
    return f"alert_{uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def token(client: AsyncClient) -> str:
    email, pw = _email(), "Secure123!"
    await client.post(f"{BASE_AUTH}/register", json={
        "email": email, "password": pw, "full_name": "Alert Tester",
    })
    login = await client.post(f"{BASE_AUTH}/login", json={"email": email, "password": pw})
    return login.json()["access_token"]


async def test_list_alerts_empty(client: AsyncClient, token: str):
    resp = await client.get(BASE_ALERTS, headers=_headers(token))
    assert resp.status_code == 200
    assert resp.json() == []


async def test_create_alert(client: AsyncClient, token: str):
    resp = await client.post(
        BASE_ALERTS,
        headers=_headers(token),
        json={"symbol": "RELIANCE.NS", "price_target": 2500.0, "direction": "above"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["symbol"] == "RELIANCE.NS"
    assert body["price_target"] == 2500.0
    assert body["direction"] == "above"
    assert body["triggered"] is False
    assert "id" in body


async def test_list_alerts_after_create(client: AsyncClient, token: str):
    await client.post(
        BASE_ALERTS,
        headers=_headers(token),
        json={"symbol": "TCS.NS", "price_target": 3000.0, "direction": "below"},
    )
    resp = await client.get(BASE_ALERTS, headers=_headers(token))
    assert resp.status_code == 200
    symbols = [a["symbol"] for a in resp.json()]
    assert "TCS.NS" in symbols


async def test_delete_alert(client: AsyncClient, token: str):
    create = await client.post(
        BASE_ALERTS,
        headers=_headers(token),
        json={"symbol": "INFY.NS", "price_target": 1500.0, "direction": "above"},
    )
    alert_id = create.json()["id"]

    delete = await client.delete(f"{BASE_ALERTS}/{alert_id}", headers=_headers(token))
    assert delete.status_code == 204

    resp = await client.get(BASE_ALERTS, headers=_headers(token))
    ids = [a["id"] for a in resp.json()]
    assert alert_id not in ids


async def test_delete_nonexistent_alert(client: AsyncClient, token: str):
    fake_id = str(uuid4())
    resp = await client.delete(f"{BASE_ALERTS}/{fake_id}", headers=_headers(token))
    assert resp.status_code == 404


async def test_create_alert_invalid_direction(client: AsyncClient, token: str):
    resp = await client.post(
        BASE_ALERTS,
        headers=_headers(token),
        json={"symbol": "SBIN.NS", "price_target": 500.0, "direction": "sideways"},
    )
    assert resp.status_code == 422


async def test_alerts_unauthenticated(client: AsyncClient):
    resp = await client.get(BASE_ALERTS)
    assert resp.status_code == 403
