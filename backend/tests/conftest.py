import asyncio
import os
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.domain.models.quote import Quote
from app.infra.ai.technical import TechnicalIndicators
from app.infra.db.models import Base
from app.infra.db.session import get_db
from app.main import app

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://mts:mts_password@127.0.0.1:5435/mts_test",
)

# NullPool: each operation gets its own connection — no concurrent-use errors.
engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
TestSession = async_sessionmaker(engine, expire_on_commit=False)


async def override_get_db():
    async with TestSession() as session:
        yield session


app.dependency_overrides[get_db] = override_get_db


def _norm(symbol: str) -> str:
    s = symbol.upper()
    return s if s.endswith((".NS", ".BO")) else f"{s}.NS"


def _make_quote(symbol: str) -> Quote:
    normalised = _norm(symbol)
    return Quote(
        symbol=normalised,
        price=1000.0,
        change=10.0,
        change_pct=1.0,
        volume=500_000,
        day_high=1020.0,
        day_low=980.0,
        prev_close=990.0,
        exchange="NSE",
    )


async def _fake_get_quote(self, symbol: str) -> Quote:
    return _make_quote(symbol)


async def _fake_get_quotes(self, symbols: list[str]) -> list[Quote]:
    return [_make_quote(s) for s in symbols]


async def _fake_fetch_indicators(symbol: str) -> TechnicalIndicators:
    return TechnicalIndicators(
        symbol=symbol,
        sma_20=980.0,
        sma_50=950.0,
        rsi_14=55.0,
        macd=10.0,
        macd_signal=8.0,
        bb_upper=1050.0,
        bb_lower=950.0,
        atr_14=20.0,
        volume_ratio=1.2,
        price_vs_sma20_pct=2.0,
        trend="uptrend",
    )


# Patch YFinanceClient at module level so it is active for the entire session
# before any fixture or test runs. Using patcher.start()/stop() is more
# reliable than a `with` block inside an async generator fixture.
_p_get_quote = patch(
    "app.infra.market_data.yfinance_client.YFinanceClient.get_quote",
    new=_fake_get_quote,
)
_p_get_quotes = patch(
    "app.infra.market_data.yfinance_client.YFinanceClient.get_quotes",
    new=_fake_get_quotes,
)
_p_fetch_indicators = patch(
    "app.api.v1.ai.fetch_indicators",
    new=_fake_fetch_indicators,
)
_p_get_quote.start()
_p_get_quotes.start()
_p_fetch_indicators.start()


# Session-scoped event loop so all async fixtures and tests share one loop.
@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    _p_get_quote.stop()
    _p_get_quotes.stop()
    _p_fetch_indicators.stop()
    loop.close()


@pytest_asyncio.fixture(autouse=True, scope="session")
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client() -> AsyncClient:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
