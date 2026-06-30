from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.interfaces.repositories import TradeRepository
from app.domain.models.trade import Trade, TradeStatus
from app.infra.db.models import TradeORM


class SQLTradeRepository(TradeRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, trade_id: UUID) -> Trade | None:
        result = await self._session.execute(
            select(TradeORM).where(TradeORM.id == trade_id)
        )
        row = result.scalar_one_or_none()
        return row.to_domain() if row else None

    async def list_by_user(
        self, user_id: UUID, status: TradeStatus | None = None
    ) -> list[Trade]:
        q = (
            select(TradeORM)
            .where(TradeORM.user_id == user_id)
            .order_by(TradeORM.created_at.desc())
        )
        if status is not None:
            q = q.where(TradeORM.status == status.value)
        result = await self._session.execute(q)
        return [row.to_domain() for row in result.scalars()]

    async def create(self, trade: Trade) -> Trade:
        orm = TradeORM.from_domain(trade)
        self._session.add(orm)
        await self._session.commit()
        await self._session.refresh(orm)
        return orm.to_domain()

    async def list_all_open(self) -> list[Trade]:
        """Return every OPEN trade across all users (used by position monitor)."""
        result = await self._session.execute(
            select(TradeORM)
            .where(TradeORM.status == TradeStatus.OPEN.value)
            .order_by(TradeORM.created_at.desc())
        )
        return [row.to_domain() for row in result.scalars()]

    async def update(self, trade: Trade) -> Trade:
        orm = TradeORM.from_domain(trade)
        merged = await self._session.merge(orm)
        await self._session.commit()
        return merged.to_domain()
