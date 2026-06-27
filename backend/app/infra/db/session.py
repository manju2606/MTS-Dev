from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

_db_url = settings.DATABASE_URL.split("?")[0]  # asyncpg ignores URL ssl params; use connect_args
engine = create_async_engine(_db_url, echo=settings.DEBUG, connect_args={"ssl": False})
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
