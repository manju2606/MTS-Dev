from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.interfaces.repositories import WatchlistRepository
from app.domain.models.watchlist import WatchlistItem
from app.infra.db.models import WatchlistItemORM


class SQLWatchlistRepository(WatchlistRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_by_user(self, user_id: UUID) -> list[WatchlistItem]:
        result = await self._session.execute(
            select(WatchlistItemORM)
            .where(WatchlistItemORM.user_id == user_id)
            .order_by(WatchlistItemORM.added_at.desc())
        )
        return [row.to_domain() for row in result.scalars()]

    async def get(self, user_id: UUID, symbol: str) -> WatchlistItem | None:
        result = await self._session.execute(
            select(WatchlistItemORM).where(
                WatchlistItemORM.user_id == user_id,
                WatchlistItemORM.symbol == symbol,
            )
        )
        row = result.scalar_one_or_none()
        return row.to_domain() if row else None

    async def add(self, item: WatchlistItem) -> WatchlistItem:
        orm = WatchlistItemORM.from_domain(item)
        self._session.add(orm)
        await self._session.commit()
        await self._session.refresh(orm)
        return orm.to_domain()

    async def remove(self, user_id: UUID, symbol: str) -> bool:
        result = await self._session.execute(
            select(WatchlistItemORM).where(
                WatchlistItemORM.user_id == user_id,
                WatchlistItemORM.symbol == symbol,
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            return False
        await self._session.delete(row)
        await self._session.commit()
        return True
