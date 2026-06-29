"""Integration tests for ML prediction endpoints."""
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.infra.ml.predictor import MLPrediction

BASE = "/api/v1/ml"
AUTH = "/api/v1/auth"

_FAKE_PRED = MLPrediction(
    symbol="RELIANCE.NS",
    prediction="UP",
    probability=0.73,
    feature_importances={
        "rsi": 0.18, "macd": 0.14, "macd_hist": 0.12, "sma20_ratio": 0.10,
        "sma50_ratio": 0.09, "bb_position": 0.08, "atr_pct": 0.07,
        "vol_ratio": 0.06, "ret_1d": 0.06, "ret_5d": 0.05,
        "ret_20d": 0.04, "high_low_ratio": 0.04, "price_vs_52w_high": 0.04,
        "obv_trend": 0.03,
    },
    training_samples=240,
    accuracy_cv=0.64,
)

_p_predict = patch(
    "app.api.v1.ml_api.predict",
    new_callable=AsyncMock,
    return_value=_FAKE_PRED,
)
_p_predict.start()


def _email() -> str:
    return f"ml_{uuid.uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def token(client: AsyncClient) -> str:
    email, pw = _email(), "Secure123!"
    await client.post(AUTH + "/register", json={"email": email, "password": pw, "full_name": "ML"})
    r = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


async def test_predict_symbol(client: AsyncClient, token: str) -> None:
    r = await client.get(BASE + "/predict/RELIANCE", headers=_headers(token))
    assert r.status_code == 200
    body = r.json()
    _assert_prediction_shape(body)
    assert body["prediction"] in ("UP", "DOWN")
    assert 0.0 <= body["probability"] <= 1.0
    assert 0.0 <= body["accuracy_cv"] <= 1.0
    assert body["training_samples"] > 0
    assert isinstance(body["feature_importances"], dict)
    assert len(body["feature_importances"]) > 0


async def test_predict_batch(client: AsyncClient, token: str) -> None:
    r = await client.post(
        BASE + "/predict/batch",
        json={"symbols": ["RELIANCE", "TCS", "INFY"]},
        headers=_headers(token),
    )
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) == 3
    for item in data:
        _assert_prediction_shape(item)


async def test_predict_batch_empty(client: AsyncClient, token: str) -> None:
    r = await client.post(
        BASE + "/predict/batch",
        json={"symbols": []},
        headers=_headers(token),
    )
    assert r.status_code == 200
    assert r.json() == []


async def test_predict_unauthenticated(client: AsyncClient) -> None:
    r = await client.get(BASE + "/predict/RELIANCE")
    assert r.status_code in (401, 403)


async def test_predict_batch_unauthenticated(client: AsyncClient) -> None:
    r = await client.post(BASE + "/predict/batch", json={"symbols": ["RELIANCE"]})
    assert r.status_code in (401, 403)


def _assert_prediction_shape(body: dict) -> None:
    for field in ("symbol", "prediction", "probability",
                  "feature_importances", "training_samples", "accuracy_cv"):
        assert field in body, f"Missing field: {field}"
