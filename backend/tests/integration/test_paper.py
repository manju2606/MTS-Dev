from uuid import uuid4

import pytest
from httpx import AsyncClient

BASE = "/api/v1/paper"
AUTH = "/api/v1/auth"


def _email() -> str:
    return f"trader_{uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def auth(client: AsyncClient) -> dict:
    email, password = _email(), "Secure123!"
    reg = await client.post(AUTH + "/register", json={
        "email": email, "password": password, "full_name": "Test Trader",
    })
    assert reg.status_code == 201
    login = await client.post(AUTH + "/login", json={"email": email, "password": password})
    assert login.status_code == 200
    return {"token": login.json()["access_token"], "user_id": reg.json()["id"]}


# Fake market price is ₹1000 — use these as valid BUY params
VALID_BUY = {
    "symbol": "RELIANCE",
    "signal": "BUY",
    "stop_loss": 950.0,
    "target": 1100.0,
    "quantity": 10,
}

VALID_SELL = {
    "symbol": "TCS",
    "signal": "SELL",
    "stop_loss": 1050.0,
    "target": 900.0,
    "quantity": 5,
}


# --- Place trade ---

async def test_place_buy_trade(client: AsyncClient, auth: dict):
    resp = await client.post(BASE + "/trades", json=VALID_BUY, headers=_headers(auth["token"]))
    assert resp.status_code == 201
    body = resp.json()
    assert body["symbol"] == "RELIANCE.NS"
    assert body["signal"] == "BUY"
    assert body["status"] == "open"
    assert body["mode"] == "paper"
    assert body["entry_price"] == 1000.0
    assert body["quantity"] == 10
    assert body["risk_reward_ratio"] > 0
    assert body["pnl"] is None


async def test_place_sell_trade(client: AsyncClient, auth: dict):
    resp = await client.post(BASE + "/trades", json=VALID_SELL, headers=_headers(auth["token"]))
    assert resp.status_code == 201
    body = resp.json()
    assert body["signal"] == "SELL"
    assert body["status"] == "open"


async def test_place_trade_buy_stop_above_entry(client: AsyncClient, auth: dict):
    resp = await client.post(BASE + "/trades", json={
        **VALID_BUY, "stop_loss": 1050.0,  # above ₹1000 — invalid for BUY
    }, headers=_headers(auth["token"]))
    assert resp.status_code == 422


async def test_place_trade_buy_target_below_entry(client: AsyncClient, auth: dict):
    resp = await client.post(BASE + "/trades", json={
        **VALID_BUY, "target": 950.0,  # below ₹1000 — invalid for BUY
    }, headers=_headers(auth["token"]))
    assert resp.status_code == 422


async def test_place_trade_sell_stop_below_entry(client: AsyncClient, auth: dict):
    resp = await client.post(BASE + "/trades", json={
        **VALID_SELL, "stop_loss": 950.0,  # below ₹1000 — invalid for SELL
    }, headers=_headers(auth["token"]))
    assert resp.status_code == 422


async def test_place_trade_zero_quantity(client: AsyncClient, auth: dict):
    resp = await client.post(BASE + "/trades", json={
        **VALID_BUY, "quantity": 0,
    }, headers=_headers(auth["token"]))
    assert resp.status_code == 422


async def test_place_trade_unauthenticated(client: AsyncClient):
    resp = await client.post(BASE + "/trades", json=VALID_BUY)
    assert resp.status_code in (401, 403)


# --- List trades ---

async def test_list_trades(client: AsyncClient, auth: dict):
    await client.post(BASE + "/trades", json=VALID_BUY, headers=_headers(auth["token"]))
    await client.post(BASE + "/trades", json=VALID_SELL, headers=_headers(auth["token"]))

    resp = await client.get(BASE + "/trades", headers=_headers(auth["token"]))
    assert resp.status_code == 200
    assert len(resp.json()) >= 2


async def test_list_trades_filter_by_status(client: AsyncClient, auth: dict):
    place = await client.post(
        BASE + "/trades", json=VALID_BUY, headers=_headers(auth["token"])
    )
    trade_id = place.json()["id"]
    await client.post(
        BASE + f"/trades/{trade_id}/close", headers=_headers(auth["token"])
    )

    open_resp = await client.get(
        BASE + "/trades?status=open", headers=_headers(auth["token"])
    )
    closed_resp = await client.get(
        BASE + "/trades?status=closed", headers=_headers(auth["token"])
    )
    open_ids = {t["id"] for t in open_resp.json()}
    closed_ids = {t["id"] for t in closed_resp.json()}
    assert trade_id not in open_ids
    assert trade_id in closed_ids


# --- Get trade ---

async def test_get_trade(client: AsyncClient, auth: dict):
    place = await client.post(
        BASE + "/trades", json=VALID_BUY, headers=_headers(auth["token"])
    )
    trade_id = place.json()["id"]

    resp = await client.get(BASE + f"/trades/{trade_id}", headers=_headers(auth["token"]))
    assert resp.status_code == 200
    assert resp.json()["id"] == trade_id


async def test_get_other_users_trade(client: AsyncClient, auth: dict):
    place = await client.post(
        BASE + "/trades", json=VALID_BUY, headers=_headers(auth["token"])
    )
    trade_id = place.json()["id"]

    # Register a second user
    email2, pw2 = _email(), "Secure123!"
    await client.post(AUTH + "/register", json={
        "email": email2, "password": pw2, "full_name": "Other User",
    })
    login2 = await client.post(AUTH + "/login", json={"email": email2, "password": pw2})
    token2 = login2.json()["access_token"]

    resp = await client.get(BASE + f"/trades/{trade_id}", headers=_headers(token2))
    assert resp.status_code == 404


# --- Close trade ---

async def test_close_trade(client: AsyncClient, auth: dict):
    place = await client.post(
        BASE + "/trades", json=VALID_BUY, headers=_headers(auth["token"])
    )
    trade_id = place.json()["id"]

    resp = await client.post(
        BASE + f"/trades/{trade_id}/close", headers=_headers(auth["token"])
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "closed"
    assert body["exit_price"] == 1000.0  # fake market price
    assert body["pnl"] == 0.0            # entry == exit in fake client
    assert body["closed_at"] is not None


async def test_close_already_closed_trade(client: AsyncClient, auth: dict):
    place = await client.post(
        BASE + "/trades", json=VALID_BUY, headers=_headers(auth["token"])
    )
    trade_id = place.json()["id"]
    await client.post(BASE + f"/trades/{trade_id}/close", headers=_headers(auth["token"]))

    resp = await client.post(
        BASE + f"/trades/{trade_id}/close", headers=_headers(auth["token"])
    )
    assert resp.status_code == 409


async def test_close_nonexistent_trade(client: AsyncClient, auth: dict):
    resp = await client.post(
        BASE + f"/trades/{uuid4()}/close", headers=_headers(auth["token"])
    )
    assert resp.status_code == 404
