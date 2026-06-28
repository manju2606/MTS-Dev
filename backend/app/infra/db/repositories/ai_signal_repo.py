from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.interfaces.repositories import AISignalRepository
from app.domain.models.ai_signal import AISignal
from app.infra.db.models import AISignalORM


class SQLAISignalRepository(AISignalRepository):
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def save(self, signal: AISignal) -> AISignal:
        orm = AISignalORM.from_domain(signal)
        self._db.add(orm)
        await self._db.commit()
        await self._db.refresh(orm)
        return orm.to_domain()

    async def list_by_user(
        self, user_id: UUID, symbol: str | None = None, limit: int = 50
    ) -> list[AISignal]:
        stmt = (
            select(AISignalORM)
            .where(AISignalORM.user_id == user_id)
            .order_by(desc(AISignalORM.created_at))
            .limit(limit)
        )
        if symbol:
            stmt = stmt.where(AISignalORM.symbol == symbol)
        result = await self._db.execute(stmt)
        return [row.to_domain() for row in result.scalars().all()]
