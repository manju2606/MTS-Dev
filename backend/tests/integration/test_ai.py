"""Integration tests for AI analysis and signal history endpoints."""

import uuid

import pytest
from httpx import AsyncClient

BASE = "/api/v1/ai"
AUTH = "/api/v1/auth"

_REQUIRED_FIELDS = {
    "signal",
    "confidence",
    "entry_price",
    "stop_loss",
    "target",
    "risk_reward_ratio",
    "holding_period",
    "explanation",
}


def _email() -> str:
    return f"ai_{uuid.uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def auth(client: AsyncClient) -> dict:
    email, pw = _email(), "Secure123!"
    await client.post(
        AUTH + "/register",
        json={
            "email": email,
            "password": pw,
            "full_name": "AI Test",
        },
    )
    login = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    assert login.status_code == 200
    return {"token": login.json()["access_token"], "email": email}


async def test_analyze_symbol(client: AsyncClient, auth: dict) -> None:
    resp = await client.post(BASE + "/analyze/RELIANCE", headers=_headers(auth["token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert all(k in body for k in _REQUIRED_FIELDS)
    assert body["signal"] in ("BUY", "SELL", "HOLD")
    assert 0.0 <= body["confidence"] <= 1.0
    assert body["entry_price"] > 0
    assert body["stop_loss"] > 0
    assert body["target"] > 0
    assert body["risk_reward_ratio"] >= 0


async def test_analyze_symbol_normalises(client: AsyncClient, auth: dict) -> None:
    # Both RELIANCE and RELIANCE.NS should succeed
    h = _headers(auth["token"])
    r1 = await client.post(BASE + "/analyze/RELIANCE", headers=h)
    r2 = await client.post(BASE + "/analyze/RELIANCE.NS", headers=h)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["signal"] == r2.json()["signal"]


async def test_analyze_batch(client: AsyncClient, auth: dict) -> None:
    resp = await client.post(
        BASE + "/analyze/batch",
        json={"symbols": ["RELIANCE", "TCS", "INFY"]},
        headers=_headers(auth["token"]),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    for item in data:
        assert all(k in item for k in _REQUIRED_FIELDS)


async def test_signal_history_empty(client: AsyncClient, auth: dict) -> None:
    # Fresh user — history starts empty
    email, pw = _email(), "Secure123!"
    await client.post(
        AUTH + "/register", json={"email": email, "password": pw, "full_name": "Fresh"}
    )
    login = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    token = login.json()["access_token"]

    resp = await client.get(BASE + "/history", headers=_headers(token))
    assert resp.status_code == 200
    assert resp.json() == []


async def test_signal_history_populated(client: AsyncClient, auth: dict) -> None:
    h = _headers(auth["token"])

    # Analyze WIPRO to create a signal
    await client.post(BASE + "/analyze/WIPRO", headers=h)

    resp = await client.get(BASE + "/history", headers=h)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    # Should contain the symbol we analyzed
    symbols = [s["symbol"] for s in data]
    assert any("WIPRO" in sym for sym in symbols)


async def test_signal_history_filtered(client: AsyncClient, auth: dict) -> None:
    h = _headers(auth["token"])

    await client.post(BASE + "/analyze/HDFCBANK", headers=h)

    resp = await client.get(BASE + "/history?symbol=HDFCBANK.NS", headers=h)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert all(s["symbol"] == "HDFCBANK.NS" for s in data)


async def test_ai_unauthenticated(client: AsyncClient) -> None:
    resp = await client.post(BASE + "/analyze/RELIANCE")
    assert resp.status_code in (401, 403)


async def test_ai_history_unauthenticated(client: AsyncClient) -> None:
    resp = await client.get(BASE + "/history")
    assert resp.status_code in (401, 403)
