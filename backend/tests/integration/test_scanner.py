"""Integration tests for scanner watchlist CRUD endpoints."""

import uuid

import pytest
from httpx import AsyncClient

BASE = "/api/v1/scanner"
AUTH = "/api/v1/auth"


def _email() -> str:
    return f"scanner_{uuid.uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def auth(client: AsyncClient) -> dict:
    email, pw = _email(), "Secure123!"
    reg = await client.post(
        AUTH + "/register",
        json={
            "email": email,
            "password": pw,
            "full_name": "Scanner Test",
        },
    )
    assert reg.status_code == 201
    login = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    assert login.status_code == 200
    return {"token": login.json()["access_token"]}


async def test_watchlist_crud(client: AsyncClient, auth: dict) -> None:
    h = _headers(auth["token"])

    # Create
    resp = await client.post(BASE + "/watchlists", json={"name": "My WL"}, headers=h)
    assert resp.status_code == 201
    wl = resp.json()
    assert wl["name"] == "My WL"
    wl_id = wl["id"]

    # List — new watchlist is present
    resp = await client.get(BASE + "/watchlists", headers=h)
    assert resp.status_code == 200
    assert any(w["id"] == wl_id for w in resp.json())

    # Add item (mocked quote returns RELIANCE.NS / NSE)
    resp = await client.post(
        f"{BASE}/watchlists/{wl_id}/items",
        json={"symbol": "RELIANCE"},
        headers=h,
    )
    assert resp.status_code == 201
    item = resp.json()
    assert "RELIANCE" in item["symbol"]
    assert item["exchange"] == "NSE"

    # List items
    resp = await client.get(f"{BASE}/watchlists/{wl_id}/items", headers=h)
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # Duplicate item → 409
    resp = await client.post(
        f"{BASE}/watchlists/{wl_id}/items",
        json={"symbol": "RELIANCE"},
        headers=h,
    )
    assert resp.status_code == 409

    # Remove item
    resp = await client.delete(
        f"{BASE}/watchlists/{wl_id}/items/RELIANCE.NS",
        headers=h,
    )
    assert resp.status_code == 204

    # Items list is now empty
    resp = await client.get(f"{BASE}/watchlists/{wl_id}/items", headers=h)
    assert resp.json() == []

    # Delete watchlist
    resp = await client.delete(f"{BASE}/watchlists/{wl_id}", headers=h)
    assert resp.status_code == 204

    # Gone from list
    resp = await client.get(BASE + "/watchlists", headers=h)
    assert all(w["id"] != wl_id for w in resp.json())


async def test_rename_watchlist(client: AsyncClient, auth: dict) -> None:
    h = _headers(auth["token"])
    resp = await client.post(BASE + "/watchlists", json={"name": "OldName"}, headers=h)
    wl_id = resp.json()["id"]

    resp = await client.patch(f"{BASE}/watchlists/{wl_id}", json={"name": "NewName"}, headers=h)
    assert resp.status_code == 200
    assert resp.json()["name"] == "NewName"


async def test_duplicate_watchlist_name(client: AsyncClient, auth: dict) -> None:
    h = _headers(auth["token"])
    await client.post(BASE + "/watchlists", json={"name": "DupWL"}, headers=h)
    resp = await client.post(BASE + "/watchlists", json={"name": "DupWL"}, headers=h)
    assert resp.status_code == 409


async def test_watchlist_not_found(client: AsyncClient, auth: dict) -> None:
    h = _headers(auth["token"])
    bad_id = str(uuid.uuid4())
    resp = await client.get(f"{BASE}/watchlists/{bad_id}/items", headers=h)
    assert resp.status_code == 404


async def test_delete_watchlist_not_found(client: AsyncClient, auth: dict) -> None:
    h = _headers(auth["token"])
    bad_id = str(uuid.uuid4())
    resp = await client.delete(f"{BASE}/watchlists/{bad_id}", headers=h)
    assert resp.status_code == 404


async def test_watchlist_unauthenticated(client: AsyncClient) -> None:
    resp = await client.get(BASE + "/watchlists")
    assert resp.status_code in (401, 403)
