"""Integration tests for the ensemble AI endpoint.

conftest.py already mocks YFinanceClient.get_quote (price=1000) and
fetch_indicators — only predict needs to be patched here since the ML
predictor trains on real yfinance data.
"""
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.infra.ml.predictor import MLPrediction

AUTH = "/api/v1/auth"
BASE = "/api/v1/ai"

_FAKE_ML = MLPrediction(
    symbol="RELIANCE.NS",
    prediction="UP",
    probability=0.78,
    feature_importances={"rsi": 0.18, "macd": 0.14},
    training_samples=450,
    accuracy_cv=0.62,
)

# Only patch predict — conftest handles get_quote and fetch_indicators.
_p_ml = patch(
    "app.infra.ml.predictor.predict",
    new_callable=AsyncMock,
    return_value=_FAKE_ML,
)
_p_ml.start()


def _email() -> str:
    return f"ens_{uuid.uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def token(client: AsyncClient) -> str:
    email, pw = _email(), "Secure123!"
    await client.post(AUTH + "/register", json={"email": email, "password": pw, "full_name": "E"})
    r = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


async def test_ensemble_consensus(client: AsyncClient, token: str) -> None:
    r = await client.post(BASE + "/ensemble/RELIANCE", headers=_headers(token))
    assert r.status_code == 200
    body = r.json()
    assert "consensus" in body
    assert "engines" in body
    assert body["consensus"]["signal"] in ("BUY", "SELL", "HOLD")
    assert 0.0 <= body["consensus"]["confidence"] <= 1.0
    assert "local" in body["engines"]
    assert "ml" in body["engines"]


async def test_ensemble_ml_fields(client: AsyncClient, token: str) -> None:
    r = await client.post(BASE + "/ensemble/TCS", headers=_headers(token))
    assert r.status_code == 200
    ml = r.json()["engines"]["ml"]
    assert ml["prediction"] in ("UP", "DOWN")
    assert "probability" in ml
    assert "accuracy_cv" in ml


async def test_ensemble_price_levels(client: AsyncClient, token: str) -> None:
    r = await client.post(BASE + "/ensemble/INFY", headers=_headers(token))
    body = r.json()["consensus"]
    assert body["entry_price"] > 0
    assert body["stop_loss"] > 0
    assert body["target"] > 0
    assert body["risk_reward_ratio"] >= 0


async def test_ensemble_unauthenticated(client: AsyncClient) -> None:
    r = await client.post(BASE + "/ensemble/RELIANCE")
    assert r.status_code in (401, 403)


async def test_ensemble_viewer_forbidden(client: AsyncClient) -> None:
    email, pw = _email(), "Secure123!"
    await client.post(AUTH + "/register", json={"email": email, "password": pw, "full_name": "V"})
    login = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    tok = login.json()["access_token"]

    from sqlalchemy import update

    from app.infra.db.models import UserORM
    from tests.conftest import TestSession

    me = await client.get(AUTH + "/me", headers=_headers(tok))
    uid = me.json()["id"]
    async with TestSession() as s:
        await s.execute(
            update(UserORM).where(UserORM.id == uuid.UUID(uid)).values(role="viewer")
        )
        await s.commit()

    tok2 = (
        await client.post(AUTH + "/login", json={"email": email, "password": pw})
    ).json()["access_token"]
    r = await client.post(BASE + "/ensemble/RELIANCE", headers=_headers(tok2))
    assert r.status_code == 403
