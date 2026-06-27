import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import get_market_data_client
from app.domain.interfaces.market_data import MarketDataClient
from app.domain.models.quote import Quote
from app.infra.db.models import Base
from app.infra.db.session import get_db
from app.main import app

TEST_DATABASE_URL = "postgresql+asyncpg://mts:mts_password@localhost:5432/mts_test"

engine = create_async_engine(TEST_DATABASE_URL)
TestSession = async_sessionmaker(engine, expire_on_commit=False)


async def override_get_db():
    async with TestSession() as session:
        yield session


class FakeMarketDataClient(MarketDataClient):
    """Returns a fixed ₹1000 quote for any valid-looking symbol."""

    async def get_quote(self, symbol: str) -> Quote:
        upper = symbol.upper()
        if not (upper.endswith(".NS") or upper.endswith(".BO")):
            upper = f"{upper}.NS"
        return Quote(
            symbol=upper,
            price=1000.0,
            change=10.0,
            change_pct=1.0,
            volume=500_000,
            day_high=1020.0,
            day_low=980.0,
            prev_close=990.0,
            exchange="NSE",
        )

    async def get_quotes(self, symbols: list[str]) -> list[Quote]:
        return [await self.get_quote(s) for s in symbols]


app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[get_market_data_client] = lambda: FakeMarketDataClient()


@pytest.fixture(autouse=True, scope="session")
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
