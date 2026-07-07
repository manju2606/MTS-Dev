"""Integration tests for backtesting endpoints."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.domain.services.backtester import BacktestResult, BacktestTrade

BASE = "/api/v1/backtest"
AUTH = "/api/v1/auth"

_FAKE_RESULT = BacktestResult(
    symbol="RELIANCE.NS",
    strategy="SMA 20/50 Crossover",
    period="6mo",
    start_date="2024-01-15",
    end_date="2024-06-28",
    total_return_pct=12.5,
    max_drawdown_pct=4.2,
    win_rate_pct=60.0,
    total_trades=3,
    sharpe_ratio=1.45,
    trades=[
        BacktestTrade("2024-01-15", "2024-02-20", "BUY", 2400.0, 2650.0, 250.0, 10.4),
        BacktestTrade("2024-03-01", "2024-04-15", "BUY", 2600.0, 2550.0, -50.0, -1.9),
        BacktestTrade("2024-05-01", "2024-06-15", "BUY", 2500.0, 2800.0, 300.0, 12.0),
    ],
    equity_curve=[
        {"date": "2024-01-15", "value": 100_000},
        {"date": "2024-06-28", "value": 112_500},
    ],
)

_p_sma = patch(
    "app.api.v1.backtest.Backtester.run_sma_crossover",
    new_callable=AsyncMock,
    return_value=_FAKE_RESULT,
)
_p_rsi = patch(
    "app.api.v1.backtest.Backtester.run_rsi_mean_reversion",
    new_callable=AsyncMock,
    return_value=_FAKE_RESULT,
)
_p_macd = patch(
    "app.api.v1.backtest.Backtester.run_macd_crossover",
    new_callable=AsyncMock,
    return_value=_FAKE_RESULT,
)
_p_sma.start()
_p_rsi.start()
_p_macd.start()


def _email() -> str:
    return f"bt_{uuid.uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def token(client: AsyncClient) -> str:
    email, pw = _email(), "Secure123!"
    await client.post(AUTH + "/register", json={"email": email, "password": pw, "full_name": "BT"})
    r = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


async def test_list_strategies(client: AsyncClient, token: str) -> None:
    r = await client.get(BASE + "/strategies", headers=_headers(token))
    assert r.status_code == 200
    strats = r.json()
    assert isinstance(strats, list)
    assert len(strats) == 3
    ids = {s["id"] for s in strats}
    assert ids == {"sma_crossover", "rsi_mean_reversion", "macd_crossover"}
    for s in strats:
        assert "name" in s and "description" in s


async def test_run_sma_crossover(client: AsyncClient, token: str) -> None:
    r = await client.post(
        BASE + "/run",
        json={"symbol": "RELIANCE", "period": "6mo", "strategy": "sma_crossover"},
        headers=_headers(token),
    )
    assert r.status_code == 200
    body = r.json()
    _assert_result_shape(body)
    assert body["symbol"] == "RELIANCE.NS"
    assert len(body["trades"]) == 3


async def test_run_rsi_mean_reversion(client: AsyncClient, token: str) -> None:
    r = await client.post(
        BASE + "/run",
        json={"symbol": "TCS", "period": "1y", "strategy": "rsi_mean_reversion"},
        headers=_headers(token),
    )
    assert r.status_code == 200
    _assert_result_shape(r.json())


async def test_run_macd_crossover(client: AsyncClient, token: str) -> None:
    r = await client.post(
        BASE + "/run",
        json={"symbol": "INFY", "period": "6mo", "strategy": "macd_crossover"},
        headers=_headers(token),
    )
    assert r.status_code == 200
    _assert_result_shape(r.json())


async def test_run_invalid_period(client: AsyncClient, token: str) -> None:
    r = await client.post(
        BASE + "/run",
        json={"symbol": "RELIANCE", "period": "5y"},
        headers=_headers(token),
    )
    assert r.status_code == 422


async def test_run_invalid_strategy(client: AsyncClient, token: str) -> None:
    r = await client.post(
        BASE + "/run",
        json={"symbol": "RELIANCE", "period": "6mo", "strategy": "bollinger_bands"},
        headers=_headers(token),
    )
    assert r.status_code == 422


async def test_run_two_year_period(client: AsyncClient, token: str) -> None:
    r = await client.post(
        BASE + "/run",
        json={"symbol": "RELIANCE", "period": "2y"},
        headers=_headers(token),
    )
    assert r.status_code == 200


async def test_backtest_unauthenticated(client: AsyncClient) -> None:
    r = await client.post(BASE + "/run", json={"symbol": "RELIANCE", "period": "6mo"})
    assert r.status_code in (401, 403)


def _assert_result_shape(body: dict) -> None:
    for field in (
        "symbol",
        "strategy",
        "period",
        "start_date",
        "end_date",
        "total_return_pct",
        "max_drawdown_pct",
        "win_rate_pct",
        "total_trades",
        "sharpe_ratio",
        "trades",
        "equity_curve",
    ):
        assert field in body, f"Missing field: {field}"
    assert isinstance(body["trades"], list)
    assert isinstance(body["equity_curve"], list)
    assert isinstance(body["total_return_pct"], float | int)
