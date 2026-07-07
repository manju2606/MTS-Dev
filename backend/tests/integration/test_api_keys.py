"""Integration tests for API key management and API-key-based authentication."""

import uuid

import pytest
from httpx import AsyncClient

AUTH = "/api/v1/auth"


def _email() -> str:
    return f"apikey_{uuid.uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def token(client: AsyncClient) -> str:
    email, pw = _email(), "Secure123!"
    await client.post(AUTH + "/register", json={"email": email, "password": pw, "full_name": "AK"})
    r = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


async def test_create_api_key(client: AsyncClient, token: str) -> None:
    r = await client.post(
        AUTH + "/api-keys",
        json={"name": "Test Key"},
        headers=_headers(token),
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Test Key"
    assert "raw_key" in body
    assert body["raw_key"].startswith("mts_")
    assert len(body["raw_key"]) == 68
    assert "key_prefix" in body
    assert "id" in body


async def test_list_api_keys(client: AsyncClient, token: str) -> None:
    await client.post(AUTH + "/api-keys", json={"name": "K1"}, headers=_headers(token))
    await client.post(AUTH + "/api-keys", json={"name": "K2"}, headers=_headers(token))
    r = await client.get(AUTH + "/api-keys", headers=_headers(token))
    assert r.status_code == 200
    keys = r.json()
    assert len(keys) >= 2
    assert all("raw_key" not in k for k in keys)  # plaintext never returned in list


async def test_authenticate_with_api_key(client: AsyncClient, token: str) -> None:
    # Create a key
    cr = await client.post(AUTH + "/api-keys", json={"name": "Auth Key"}, headers=_headers(token))
    raw = cr.json()["raw_key"]

    # Use it to call /me — no Bearer token
    r = await client.get(AUTH + "/me", headers={"X-API-Key": raw})
    assert r.status_code == 200
    body = r.json()
    assert "email" in body
    assert "subscription_tier" in body
    assert body["subscription_tier"] == "free"


async def test_revoke_api_key(client: AsyncClient, token: str) -> None:
    cr = await client.post(AUTH + "/api-keys", json={"name": "Revoke Me"}, headers=_headers(token))
    key_id = cr.json()["id"]
    raw = cr.json()["raw_key"]

    # Revoke
    r = await client.delete(AUTH + f"/api-keys/{key_id}", headers=_headers(token))
    assert r.status_code == 204

    # Key no longer works
    r2 = await client.get(AUTH + "/me", headers={"X-API-Key": raw})
    assert r2.status_code == 401


async def test_revoke_nonexistent_key(client: AsyncClient, token: str) -> None:
    r = await client.delete(AUTH + f"/api-keys/{uuid.uuid4()}", headers=_headers(token))
    assert r.status_code == 404


async def test_revoked_key_not_in_list(client: AsyncClient, token: str) -> None:
    cr = await client.post(AUTH + "/api-keys", json={"name": "Gone"}, headers=_headers(token))
    key_id = cr.json()["id"]
    await client.delete(AUTH + f"/api-keys/{key_id}", headers=_headers(token))

    keys = (await client.get(AUTH + "/api-keys", headers=_headers(token))).json()
    assert not any(k["id"] == key_id for k in keys)


async def test_api_key_unauthenticated(client: AsyncClient) -> None:
    r = await client.post(AUTH + "/api-keys", json={"name": "x"})
    assert r.status_code in (401, 403)


async def test_me_returns_tier_and_email_verified(client: AsyncClient, token: str) -> None:
    r = await client.get(AUTH + "/me", headers=_headers(token))
    assert r.status_code == 200
    body = r.json()
    assert body["subscription_tier"] == "free"
    assert body["email_verified"] is False
