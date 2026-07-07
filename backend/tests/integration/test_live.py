"""Integration tests for live trading endpoints."""

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.domain.models.order import LiveOrder

BASE = "/api/v1/live"
AUTH = "/api/v1/auth"

_FAKE_ORDER = LiveOrder(
    user_id=uuid.uuid4(),
    symbol="RELIANCE.NS",
    exchange="NSE",
    signal="BUY",
    quantity=5,
    order_type="MARKET",
    broker="simulated",
    broker_order_id="sim-001",
    status="filled",
    fill_price=2450.50,
    fill_time=datetime.utcnow(),
)

_p_place = patch(
    "app.infra.brokers.simulated.SimulatedBroker.place_order",
    new_callable=AsyncMock,
    return_value=_FAKE_ORDER,
)
_p_positions = patch(
    "app.infra.brokers.simulated.SimulatedBroker.get_positions",
    new_callable=AsyncMock,
    return_value=[
        {
            "symbol": "RELIANCE.NS",
            "exchange": "NSE",
            "signal": "BUY",
            "quantity": 5,
            "avg_price": 2450.50,
        }
    ],
)
_p_cancel = patch(
    "app.infra.brokers.simulated.SimulatedBroker.cancel_order",
    new_callable=AsyncMock,
    return_value=True,
)
_p_place.start()
_p_positions.start()
_p_cancel.start()


def _email() -> str:
    return f"live_{uuid.uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def token(client: AsyncClient) -> str:
    email, pw = _email(), "Secure123!"
    await client.post(
        AUTH + "/register", json={"email": email, "password": pw, "full_name": "Trader"}
    )
    r = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


async def test_place_market_order(client: AsyncClient, token: str) -> None:
    r = await client.post(
        BASE + "/orders",
        json={"symbol": "RELIANCE", "signal": "BUY", "quantity": 5, "order_type": "MARKET"},
        headers=_headers(token),
    )
    assert r.status_code == 201
    body = r.json()
    assert body["signal"] == "BUY"
    assert body["quantity"] == 5
    assert body["status"] == "filled"
    assert body["fill_price"] is not None
    assert "id" in body
    assert "broker_order_id" in body


async def test_place_order_invalid_signal(client: AsyncClient, token: str) -> None:
    r = await client.post(
        BASE + "/orders",
        json={"symbol": "RELIANCE", "signal": "HOLD", "quantity": 1},
        headers=_headers(token),
    )
    assert r.status_code == 400


async def test_list_orders(client: AsyncClient, token: str) -> None:
    # Place an order first
    await client.post(
        BASE + "/orders",
        json={"symbol": "TCS", "signal": "BUY", "quantity": 2},
        headers=_headers(token),
    )
    r = await client.get(BASE + "/orders", headers=_headers(token))
    assert r.status_code == 200
    assert isinstance(r.json(), list)


async def test_get_positions(client: AsyncClient, token: str) -> None:
    r = await client.get(BASE + "/positions", headers=_headers(token))
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    if data:
        assert "symbol" in data[0]
        assert "quantity" in data[0]
        assert "avg_price" in data[0]


async def test_get_pnl(client: AsyncClient, token: str) -> None:
    r = await client.get(BASE + "/pnl", headers=_headers(token))
    assert r.status_code == 200
    body = r.json()
    assert "broker" in body
    assert "open_positions" in body
    assert "total_invested" in body


async def test_cancel_order(client: AsyncClient, token: str) -> None:
    r = await client.delete(BASE + "/orders/sim-001", headers=_headers(token))
    assert r.status_code == 200
    body = r.json()
    assert body["cancelled"] is True
    assert body["broker_order_id"] == "sim-001"


async def test_place_order_with_stop_target(client: AsyncClient, token: str) -> None:
    # stop_loss and target without price skips the risk gate in live.py
    r = await client.post(
        BASE + "/orders",
        json={
            "symbol": "INFY",
            "signal": "BUY",
            "quantity": 2,
            "stop_loss": 1450.0,
            "target": 1600.0,
        },
        headers=_headers(token),
    )
    assert r.status_code == 201


async def test_place_order_viewer_forbidden(client: AsyncClient) -> None:
    email, pw = _email(), "Secure123!"
    await client.post(AUTH + "/register", json={"email": email, "password": pw, "full_name": "V"})
    login = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    token = login.json()["access_token"]

    # Downgrade to viewer via DB
    from sqlalchemy import update

    from app.infra.db.models import UserORM
    from tests.conftest import TestSession

    me = await client.get(AUTH + "/me", headers=_headers(token))
    uid = me.json()["id"]
    async with TestSession() as s:
        await s.execute(update(UserORM).where(UserORM.id == uuid.UUID(uid)).values(role="viewer"))
        await s.commit()

    token = (await client.post(AUTH + "/login", json={"email": email, "password": pw})).json()[
        "access_token"
    ]
    r = await client.post(
        BASE + "/orders",
        json={"symbol": "RELIANCE", "signal": "BUY", "quantity": 1},
        headers=_headers(token),
    )
    assert r.status_code == 403


async def test_live_unauthenticated(client: AsyncClient) -> None:
    r = await client.post(
        BASE + "/orders", json={"symbol": "RELIANCE", "signal": "BUY", "quantity": 1}
    )
    assert r.status_code in (401, 403)
