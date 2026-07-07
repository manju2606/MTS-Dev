"""Integration tests for admin endpoints — user management and platform stats."""

import uuid

import pytest
from httpx import AsyncClient

BASE = "/api/v1/admin"
AUTH = "/api/v1/auth"


def _email() -> str:
    return f"admin_{uuid.uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_login(client: AsyncClient, email: str, pw: str = "Secure123!") -> str:
    await client.post(
        AUTH + "/register", json={"email": email, "password": pw, "full_name": "Test"}
    )
    r = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    assert r.status_code == 200
    return r.json()["access_token"]


async def _promote_to_admin(client: AsyncClient, admin_token: str, user_id: str) -> None:
    r = await client.patch(
        f"{BASE}/users/{user_id}",
        json={"role": "admin"},
        headers=_headers(admin_token),
    )
    assert r.status_code == 200


@pytest.fixture
async def admin_token(client: AsyncClient) -> str:
    """Creates a user, then promotes them to admin via a second admin account."""
    # First admin: seed admin directly via a second register+promote chain
    # Bootstrap: register a primary and a secondary user, promote primary to admin using itself
    # (The first registered user with a known email acts as the fixture admin for this session)
    email = f"bootstrap_admin_{uuid.uuid4().hex[:6]}@example.com"
    pw = "Admin999!"
    await client.post(
        AUTH + "/register", json={"email": email, "password": pw, "full_name": "Admin"}
    )
    token = (await client.post(AUTH + "/login", json={"email": email, "password": pw})).json()[
        "access_token"
    ]

    # Get own user_id from /me
    me = await client.get(AUTH + "/me", headers=_headers(token))
    user_id = me.json()["id"]

    # We cannot self-promote — use DB directly via the test engine's session to set role.
    # Instead: create a second account, patch first via SQL, then use first as admin.
    # Simpler: make admin directly via the ORM in a helper fixture.
    # For test isolation we use an already-admin account from a previous test if one exists,
    # or we skip the self-promotion catch-22 by having the test DB seeded.
    #
    # Practical solution: register user1, register user2, have user2 promote user1.
    # But neither starts as admin. So we must set role directly in the DB.
    from sqlalchemy import update

    from app.infra.db.models import UserORM
    from tests.conftest import TestSession

    async with TestSession() as session:
        await session.execute(
            update(UserORM).where(UserORM.id == uuid.UUID(user_id)).values(role="admin")
        )
        await session.commit()

    # Re-login to get a fresh token reflecting the new role
    token = (await client.post(AUTH + "/login", json={"email": email, "password": pw})).json()[
        "access_token"
    ]
    return token


async def test_stats_structure(client: AsyncClient, admin_token: str) -> None:
    r = await client.get(BASE + "/stats", headers=_headers(admin_token))
    assert r.status_code == 200
    body = r.json()
    assert "total_users" in body
    assert "active_users" in body
    assert "total_trades" in body
    assert "open_trades" in body
    assert "users_by_role" in body
    assert isinstance(body["total_users"], int)
    assert body["total_users"] >= 1


async def test_list_users(client: AsyncClient, admin_token: str) -> None:
    r = await client.get(BASE + "/users", headers=_headers(admin_token))
    assert r.status_code == 200
    users = r.json()
    assert isinstance(users, list)
    assert len(users) >= 1
    first = users[0]
    assert "id" in first
    assert "email" in first
    assert "role" in first
    assert "is_active" in first


async def test_update_user_role(client: AsyncClient, admin_token: str) -> None:
    # Create a target user to patch
    email = _email()
    token = await _register_login(client, email)
    me = await client.get(AUTH + "/me", headers=_headers(token))
    user_id = me.json()["id"]

    r = await client.patch(
        f"{BASE}/users/{user_id}",
        json={"role": "viewer"},
        headers=_headers(admin_token),
    )
    assert r.status_code == 200
    assert r.json()["role"] == "viewer"


async def test_update_user_deactivate(client: AsyncClient, admin_token: str) -> None:
    email = _email()
    token = await _register_login(client, email)
    me = await client.get(AUTH + "/me", headers=_headers(token))
    user_id = me.json()["id"]

    r = await client.patch(
        f"{BASE}/users/{user_id}",
        json={"is_active": False},
        headers=_headers(admin_token),
    )
    assert r.status_code == 200
    assert r.json()["is_active"] is False


async def test_update_user_invalid_role(client: AsyncClient, admin_token: str) -> None:
    email = _email()
    token = await _register_login(client, email)
    me = await client.get(AUTH + "/me", headers=_headers(token))
    user_id = me.json()["id"]

    r = await client.patch(
        f"{BASE}/users/{user_id}",
        json={"role": "superuser"},
        headers=_headers(admin_token),
    )
    assert r.status_code == 400


async def test_update_user_not_found(client: AsyncClient, admin_token: str) -> None:
    fake_id = str(uuid.uuid4())
    r = await client.patch(
        f"{BASE}/users/{fake_id}",
        json={"role": "viewer"},
        headers=_headers(admin_token),
    )
    assert r.status_code == 404


async def test_deactivate_user(client: AsyncClient, admin_token: str) -> None:
    email = _email()
    token = await _register_login(client, email)
    me = await client.get(AUTH + "/me", headers=_headers(token))
    user_id = me.json()["id"]

    r = await client.delete(f"{BASE}/users/{user_id}", headers=_headers(admin_token))
    assert r.status_code == 200
    assert r.json()["deactivated"] is True


async def test_stats_unauthenticated(client: AsyncClient) -> None:
    r = await client.get(BASE + "/stats")
    assert r.status_code in (401, 403)


async def test_admin_requires_admin_role(client: AsyncClient) -> None:
    # A regular trader should get 403 on admin endpoints
    email = _email()
    token = await _register_login(client, email)
    r = await client.get(BASE + "/stats", headers=_headers(token))
    assert r.status_code == 403
