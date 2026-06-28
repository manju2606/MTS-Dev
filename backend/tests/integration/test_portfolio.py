"""Tests for portfolio summary endpoint."""
from uuid import uuid4

import pytest
from httpx import AsyncClient

BASE_PORTFOLIO = "/api/v1/portfolio"
BASE_AUTH = "/api/v1/auth"
BASE_PAPER = "/api/v1/paper"


def _email() -> str:
    return f"port_{uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def token(client: AsyncClient) -> str:
    email, pw = _email(), "Secure123!"
    await client.post(f"{BASE_AUTH}/register", json={
        "email": email, "password": pw, "full_name": "Portfolio Tester",
    })
    login = await client.post(f"{BASE_AUTH}/login", json={"email": email, "password": pw})
    return login.json()["access_token"]


async def test_portfolio_summary_empty(client: AsyncClient, token: str):
    resp = await client.get(f"{BASE_PORTFOLIO}/summary", headers=_headers(token))
    assert resp.status_code == 200
    body = resp.json()
    assert "summary" in body
    assert "positions" in body
    assert "closed_trades" in body
    assert "equity_curve" in body
    assert "sector_allocation" in body
    assert body["positions"] == []
    assert body["summary"]["total_trades"] == 0
    assert body["summary"]["win_rate"] == 0.0


async def test_portfolio_summary_with_open_position(client: AsyncClient, token: str):
    # Place a paper trade (fake market price is ₹1000)
    place = await client.post(
        f"{BASE_PAPER}/trades",
        headers=_headers(token),
        json={
            "symbol": "TCS.NS",
            "signal": "BUY",
            "entry_price": 950.0,
            "stop_loss": 900.0,
            "target": 1100.0,
            "quantity": 10,
        },
    )
    assert place.status_code == 201

    resp = await client.get(f"{BASE_PORTFOLIO}/summary", headers=_headers(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["open_positions"] == 1
    assert len(body["positions"]) == 1
    pos = body["positions"][0]
    assert pos["symbol"] == "TCS.NS"
    assert "unrealized_pnl" in pos
    assert "current_price" in pos
    assert "sector" in pos


async def test_portfolio_unrealized_pnl_buy(client: AsyncClient, token: str):
    # Entry at 950, fake market price = 1000, qty = 5 → unrealized = +250
    await client.post(
        f"{BASE_PAPER}/trades",
        headers=_headers(token),
        json={
            "symbol": "INFY.NS",
            "signal": "BUY",
            "entry_price": 950.0,
            "stop_loss": 900.0,
            "target": 1100.0,
            "quantity": 5,
        },
    )
    resp = await client.get(f"{BASE_PORTFOLIO}/summary", headers=_headers(token))
    positions = resp.json()["positions"]
    infy = next((p for p in positions if p["symbol"] == "INFY.NS"), None)
    assert infy is not None
    assert infy["unrealized_pnl"] == pytest.approx(250.0)


async def test_portfolio_unauthenticated(client: AsyncClient):
    resp = await client.get(f"{BASE_PORTFOLIO}/summary")
    assert resp.status_code == 403
