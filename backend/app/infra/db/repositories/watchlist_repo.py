from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.interfaces.repositories import WatchlistRepository
from app.domain.models.watchlist import Watchlist, WatchlistItem
from app.infra.db.models import WatchlistItemORM, WatchlistORM


class SQLWatchlistRepository(WatchlistRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Watchlist management ──────────────────────────────────────────────

    async def create_watchlist(self, user_id: UUID, name: str) -> Watchlist:
        wl = WatchlistORM(user_id=user_id, name=name)
        self._session.add(wl)
        await self._session.commit()
        await self._session.refresh(wl)
        return wl.to_domain()

    async def list_watchlists(self, user_id: UUID) -> list[Watchlist]:
        result = await self._session.execute(
            select(WatchlistORM)
            .where(WatchlistORM.user_id == user_id)
            .order_by(WatchlistORM.created_at.asc())
        )
        return [row.to_domain() for row in result.scalars()]

    async def get_watchlist(self, watchlist_id: UUID, user_id: UUID) -> Watchlist | None:
        result = await self._session.execute(
            select(WatchlistORM).where(
                WatchlistORM.id == watchlist_id,
                WatchlistORM.user_id == user_id,
            )
        )
        row = result.scalar_one_or_none()
        return row.to_domain() if row else None

    async def rename_watchlist(self, watchlist_id: UUID, user_id: UUID, name: str) -> Watchlist:
        result = await self._session.execute(
            select(WatchlistORM).where(
                WatchlistORM.id == watchlist_id, WatchlistORM.user_id == user_id
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            raise ValueError("Watchlist not found")
        row.name = name
        await self._session.commit()
        await self._session.refresh(row)
        return row.to_domain()

    async def delete_watchlist(self, watchlist_id: UUID, user_id: UUID) -> bool:
        result = await self._session.execute(
            select(WatchlistORM).where(
                WatchlistORM.id == watchlist_id, WatchlistORM.user_id == user_id
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            return False
        await self._session.delete(row)
        await self._session.commit()
        return True

    # ── Item management (watchlist-scoped) ────────────────────────────────

    async def list_items(self, watchlist_id: UUID, user_id: UUID) -> list[WatchlistItem]:
        result = await self._session.execute(
            select(WatchlistItemORM)
            .where(
                WatchlistItemORM.watchlist_id == watchlist_id,
                WatchlistItemORM.user_id == user_id,
            )
            .order_by(WatchlistItemORM.added_at.desc())
        )
        return [row.to_domain() for row in result.scalars()]

    async def add_item(self, item: WatchlistItem) -> WatchlistItem:
        orm = WatchlistItemORM.from_domain(item)
        self._session.add(orm)
        await self._session.commit()
        await self._session.refresh(orm)
        return orm.to_domain()

    async def remove_item(self, watchlist_id: UUID, user_id: UUID, symbol: str) -> bool:
        result = await self._session.execute(
            select(WatchlistItemORM).where(
                WatchlistItemORM.watchlist_id == watchlist_id,
                WatchlistItemORM.user_id == user_id,
                WatchlistItemORM.symbol == symbol,
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            return False
        await self._session.delete(row)
        await self._session.commit()
        return True

    async def move_item(self, item_id: UUID, to_watchlist_id: UUID, user_id: UUID) -> bool:
        result = await self._session.execute(
            select(WatchlistItemORM).where(
                WatchlistItemORM.id == item_id,
                WatchlistItemORM.user_id == user_id,
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            return False
        row.watchlist_id = to_watchlist_id
        await self._session.commit()
        return True

    # ── Legacy / backward-compat ─────────────────────────────────────────

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
        return await self.add_item(item)

    async def remove(self, user_id: UUID, symbol: str) -> bool:
        result = await self._session.execute(
            select(WatchlistItemORM).where(
                WatchlistItemORM.user_id == user_id,
                WatchlistItemORM.symbol == symbol,
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            return False
        await self._session.delete(row)
        await self._session.commit()
        return True
