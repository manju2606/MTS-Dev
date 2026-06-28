"""Tests for change-password, update-profile, forgot/reset-password."""
from uuid import uuid4

import pytest
from httpx import AsyncClient

BASE = "/api/v1/auth"


def _email() -> str:
    return f"ext_{uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def auth(client: AsyncClient) -> dict:
    email, pw = _email(), "Secure123!"
    reg = await client.post(f"{BASE}/register", json={
        "email": email, "password": pw, "full_name": "Test User",
    })
    assert reg.status_code == 201
    login = await client.post(f"{BASE}/login", json={"email": email, "password": pw})
    assert login.status_code == 200
    return {"email": email, "password": pw, "token": login.json()["access_token"]}


# ── change-password ───────────────────────────────────────────────────────────

async def test_change_password_success(client: AsyncClient, auth: dict):
    resp = await client.post(
        f"{BASE}/change-password",
        headers=_headers(auth["token"]),
        json={"current_password": auth["password"], "new_password": "NewPass456!"},
    )
    assert resp.status_code == 200
    assert "successfully" in resp.json()["message"].lower()

    # Old password no longer works
    r = await client.post(f"{BASE}/login", json={"email": auth["email"], "password": auth["password"]})
    assert r.status_code == 401

    # New password works
    r = await client.post(f"{BASE}/login", json={"email": auth["email"], "password": "NewPass456!"})
    assert r.status_code == 200


async def test_change_password_wrong_current(client: AsyncClient, auth: dict):
    resp = await client.post(
        f"{BASE}/change-password",
        headers=_headers(auth["token"]),
        json={"current_password": "WrongPass!", "new_password": "NewPass456!"},
    )
    assert resp.status_code == 400
    assert "incorrect" in resp.json()["detail"].lower()


async def test_change_password_too_short(client: AsyncClient, auth: dict):
    resp = await client.post(
        f"{BASE}/change-password",
        headers=_headers(auth["token"]),
        json={"current_password": auth["password"], "new_password": "short"},
    )
    assert resp.status_code == 422


async def test_change_password_unauthenticated(client: AsyncClient):
    resp = await client.post(
        f"{BASE}/change-password",
        json={"current_password": "x", "new_password": "NewPass456!"},
    )
    assert resp.status_code in (401, 403)


# ── update profile ────────────────────────────────────────────────────────────

async def test_update_profile_success(client: AsyncClient, auth: dict):
    resp = await client.patch(
        f"{BASE}/me",
        headers=_headers(auth["token"]),
        json={"full_name": "Updated Name"},
    )
    assert resp.status_code == 200
    assert resp.json()["full_name"] == "Updated Name"

    # Verify persisted
    me = await client.get(f"{BASE}/me", headers=_headers(auth["token"]))
    assert me.json()["full_name"] == "Updated Name"


async def test_update_profile_empty_name(client: AsyncClient, auth: dict):
    resp = await client.patch(
        f"{BASE}/me",
        headers=_headers(auth["token"]),
        json={"full_name": ""},
    )
    assert resp.status_code == 422


# ── forgot / reset password ───────────────────────────────────────────────────

async def test_forgot_password_known_email(client: AsyncClient, auth: dict):
    resp = await client.post(f"{BASE}/forgot-password", json={"email": auth["email"]})
    assert resp.status_code == 200
    assert "reset_token" in resp.json()


async def test_forgot_password_unknown_email(client: AsyncClient):
    resp = await client.post(f"{BASE}/forgot-password", json={"email": _email()})
    assert resp.status_code == 200
    assert "reset_token" not in resp.json()


async def test_reset_password_flow(client: AsyncClient, auth: dict):
    fp = await client.post(f"{BASE}/forgot-password", json={"email": auth["email"]})
    token = fp.json()["reset_token"]

    rp = await client.post(f"{BASE}/reset-password", json={
        "token": token, "new_password": "ResetPass789!",
    })
    assert rp.status_code == 200

    login = await client.post(f"{BASE}/login", json={
        "email": auth["email"], "password": "ResetPass789!",
    })
    assert login.status_code == 200
