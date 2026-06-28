from datetime import timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.core.security import create_access_token

BASE = "/api/v1/auth"


def _email() -> str:
    return f"test_{uuid4().hex[:8]}@example.com"


@pytest.fixture
async def registered(client: AsyncClient) -> dict:
    email = _email()
    password = "Secure123!"
    resp = await client.post(f"{BASE}/register", json={
        "email": email,
        "password": password,
        "full_name": "Test User",
    })
    assert resp.status_code == 201
    return {"email": email, "password": password, "id": resp.json()["id"]}


@pytest.fixture
async def auth_token(client: AsyncClient, registered: dict) -> str:
    resp = await client.post(f"{BASE}/login", json={
        "email": registered["email"],
        "password": registered["password"],
    })
    assert resp.status_code == 200
    return resp.json()["access_token"]


# --- Register ---

async def test_register_success(client: AsyncClient):
    email = _email()
    resp = await client.post(f"{BASE}/register", json={
        "email": email,
        "password": "Password1!",
        "full_name": "Alice Trader",
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == email
    assert "id" in body


async def test_register_duplicate_email(client: AsyncClient, registered: dict):
    resp = await client.post(f"{BASE}/register", json={
        "email": registered["email"],
        "password": "AnotherPass1!",
        "full_name": "Duplicate",
    })
    assert resp.status_code == 400
    assert "already registered" in resp.json()["detail"].lower()


async def test_register_invalid_email(client: AsyncClient):
    resp = await client.post(f"{BASE}/register", json={
        "email": "not-an-email",
        "password": "Password1!",
        "full_name": "Bad Email",
    })
    assert resp.status_code == 422


async def test_register_missing_fields(client: AsyncClient):
    resp = await client.post(f"{BASE}/register", json={"email": _email()})
    assert resp.status_code == 422


# --- Login ---

async def test_login_success(client: AsyncClient, registered: dict):
    resp = await client.post(f"{BASE}/login", json={
        "email": registered["email"],
        "password": registered["password"],
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]


async def test_login_wrong_password(client: AsyncClient, registered: dict):
    resp = await client.post(f"{BASE}/login", json={
        "email": registered["email"],
        "password": "WrongPass999!",
    })
    assert resp.status_code == 401


async def test_login_unknown_email(client: AsyncClient):
    resp = await client.post(f"{BASE}/login", json={
        "email": _email(),
        "password": "SomePass1!",
    })
    assert resp.status_code == 401


# --- /me ---

async def test_me_success(client: AsyncClient, registered: dict, auth_token: str):
    resp = await client.get(
        f"{BASE}/me", headers={"Authorization": f"Bearer {auth_token}"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == registered["email"]
    assert body["id"] == registered["id"]
    assert body["role"] == "trader"
    assert "full_name" in body


async def test_me_no_token(client: AsyncClient):
    resp = await client.get(f"{BASE}/me")
    assert resp.status_code in (401, 403)


async def test_me_invalid_token(client: AsyncClient):
    resp = await client.get(
        f"{BASE}/me", headers={"Authorization": "Bearer not.a.valid.token"}
    )
    assert resp.status_code == 401


async def test_me_expired_token(client: AsyncClient):
    expired = create_access_token(uuid4(), expires_delta=timedelta(seconds=-1))
    resp = await client.get(
        f"{BASE}/me", headers={"Authorization": f"Bearer {expired}"}
    )
    assert resp.status_code == 401
