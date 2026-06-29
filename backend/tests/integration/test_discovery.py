"""Integration tests for the discovery engine API.

MongoDB calls are patched so these tests don't require a live MongoDB instance.
The scan trigger is patched to avoid running the full stock universe scan.
"""
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient

from app.domain.models.discovery import NewsItem, StockScore

AUTH = "/api/v1/auth"
BASE = "/api/v1/discovery"

_FAKE_SCORE = StockScore(
    id=uuid.uuid4(),
    symbol="RELIANCE.NS",
    name="Reliance Industries",
    score=74.5,
    signal="BUY",
    confidence=0.73,
    entry_price=2450.0,
    stop_loss=2380.0,
    targets=[2540.0, 2640.0, 2740.0],
    holding_period="2–4 days",
    risk_reward_ratio=1.86,
    technical_score=78.0,
    news_score=68.0,
    ml_score=72.0,
    social_score=50.0,
    patterns=["MACD above signal line — bullish crossover", "SMA-20 > SMA-50 — uptrend confirmed"],
    news_summary="",
    explanation="BUY: Technical 78/100 · News 68/100 · ML 72/100.",
    scanned_at=datetime.utcnow(),
)

_FAKE_NEWS = NewsItem(
    id=uuid.uuid4(),
    title="Reliance Industries Q4 profit beats estimates by 12%",
    source="ET Markets",
    url="https://example.com/news/1",
    published_at=datetime.utcnow(),
    sentiment_score=0.72,
    mentioned_symbols=["RELIANCE.NS"],
    summary="Reliance Industries reported Q4 profit...",
)


def _email() -> str:
    return f"disc_{uuid.uuid4().hex[:8]}@example.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def token(client: AsyncClient) -> str:
    email, pw = _email(), "Secure123!"
    await client.post(AUTH + "/register", json={"email": email, "password": pw, "full_name": "D"})
    r = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


@pytest.fixture
async def admin_token(client: AsyncClient) -> str:
    from sqlalchemy import update
    from app.infra.db.models import UserORM
    from tests.conftest import TestSession

    email, pw = _email(), "Secure123!"
    await client.post(AUTH + "/register", json={"email": email, "password": pw, "full_name": "A"})
    r = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    tok = r.json()["access_token"]
    me = await client.get(AUTH + "/me", headers=_headers(tok))
    uid = me.json()["id"]
    async with TestSession() as s:
        await s.execute(update(UserORM).where(UserORM.id == uuid.UUID(uid)).values(role="admin"))
        await s.commit()
    r2 = await client.post(AUTH + "/login", json={"email": email, "password": pw})
    return r2.json()["access_token"]


async def test_top_picks_empty(client: AsyncClient, token: str) -> None:
    with patch(
        "app.api.v1.discovery.DiscoveryRepository.get_top_picks",
        new_callable=AsyncMock,
        return_value=[],
    ):
        r = await client.get(BASE + "/top-picks", headers=_headers(token))
    assert r.status_code == 200
    assert r.json() == []


async def test_top_picks_returns_scores(client: AsyncClient, token: str) -> None:
    with patch(
        "app.api.v1.discovery.DiscoveryRepository.get_top_picks",
        new_callable=AsyncMock,
        return_value=[_FAKE_SCORE],
    ):
        r = await client.get(BASE + "/top-picks", headers=_headers(token))
    assert r.status_code == 200
    picks = r.json()
    assert len(picks) == 1
    p = picks[0]
    assert p["symbol"] == "RELIANCE.NS"
    assert p["score"] == 74.5
    assert p["signal"] == "BUY"
    assert len(p["targets"]) == 3
    assert "technical_score" in p
    assert "patterns" in p


async def test_top_picks_signal_filter(client: AsyncClient, token: str) -> None:
    with patch(
        "app.api.v1.discovery.DiscoveryRepository.get_top_picks",
        new_callable=AsyncMock,
        return_value=[_FAKE_SCORE],
    ):
        r = await client.get(BASE + "/top-picks?signal=BUY", headers=_headers(token))
    assert r.status_code == 200


async def test_top_picks_invalid_signal(client: AsyncClient, token: str) -> None:
    r = await client.get(BASE + "/top-picks?signal=INVALID", headers=_headers(token))
    assert r.status_code == 422


async def test_symbol_history(client: AsyncClient, token: str) -> None:
    with patch(
        "app.api.v1.discovery.DiscoveryRepository.get_scores_for_symbol",
        new_callable=AsyncMock,
        return_value=[_FAKE_SCORE],
    ):
        r = await client.get(BASE + "/scores/RELIANCE", headers=_headers(token))
    assert r.status_code == 200
    assert r.json()[0]["symbol"] == "RELIANCE.NS"


async def test_news_endpoint(client: AsyncClient, token: str) -> None:
    with patch(
        "app.api.v1.discovery.DiscoveryRepository.get_news",
        new_callable=AsyncMock,
        return_value=[_FAKE_NEWS],
    ):
        r = await client.get(BASE + "/news", headers=_headers(token))
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["title"] == _FAKE_NEWS.title
    assert items[0]["sentiment_score"] == 0.72


async def test_news_symbol_filter(client: AsyncClient, token: str) -> None:
    with patch(
        "app.api.v1.discovery.DiscoveryRepository.get_news",
        new_callable=AsyncMock,
        return_value=[_FAKE_NEWS],
    ):
        r = await client.get(BASE + "/news?symbol=RELIANCE", headers=_headers(token))
    assert r.status_code == 200


async def test_status_endpoint(client: AsyncClient, token: str) -> None:
    with (
        patch("app.api.v1.discovery.last_scan_info", return_value=(datetime.utcnow(), 142)),
        patch("app.api.v1.discovery.get_scheduler", return_value=None),
    ):
        r = await client.get(BASE + "/status", headers=_headers(token))
    assert r.status_code == 200
    body = r.json()
    assert "last_scan_at" in body
    assert body["stocks_scanned"] == 142
    assert body["universe_size"] > 100
    assert "social_providers" in body


async def test_trigger_scan_admin(client: AsyncClient, admin_token: str) -> None:
    with patch("app.api.v1.discovery.run_full_scan", new_callable=AsyncMock):
        r = await client.post(BASE + "/scan", headers=_headers(admin_token))
    assert r.status_code == 202
    assert r.json()["started"] is True


async def test_trigger_scan_non_admin_forbidden(client: AsyncClient, token: str) -> None:
    r = await client.post(BASE + "/scan", headers=_headers(token))
    assert r.status_code == 403


async def test_top_picks_unauthenticated(client: AsyncClient) -> None:
    r = await client.get(BASE + "/top-picks")
    assert r.status_code in (401, 403)


# ── Unit tests for scoring components ────────────────────────────────────────

async def test_sentiment_scorer() -> None:
    from app.infra.discovery.sentiment import score_text
    assert score_text("strong rally breakout bullish") > 0
    assert score_text("crash selloff bearish weak loss") < 0
    assert score_text("neutral text about weather") == 0.0


async def test_breakout_patterns() -> None:
    from unittest.mock import MagicMock
    from app.infra.discovery.breakout_scanner import detect_patterns, compute_technical_score
    from app.domain.models.quote import Quote

    quote = MagicMock(spec=Quote)
    quote.price = 1000.0
    quote.change_pct = 1.5
    ta = MagicMock()
    ta.rsi_14 = 28.0         # oversold
    ta.macd = 5.0
    ta.macd_signal = 3.0     # MACD > signal
    ta.trend = "uptrend"
    ta.price_vs_sma20_pct = 1.2
    ta.volume_ratio = 2.5    # volume surge
    ta.bb_upper = 1050.0
    ta.bb_lower = 950.0
    ta.sma_20 = 990.0
    ta.atr_14 = 20.0

    patterns = detect_patterns("RELIANCE.NS", quote, ta)
    names = [p[0] for p in patterns]
    assert "rsi_oversold" in names
    assert "volume_surge" in names
    assert "uptrend_confirmed" in names

    score = compute_technical_score(quote, ta, patterns)
    assert score > 60  # bullish setup should score high
