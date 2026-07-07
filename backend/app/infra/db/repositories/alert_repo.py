from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.interfaces.repositories import AlertRepository
from app.domain.models.alert import Alert
from app.infra.db.models import AlertORM


class SQLAlertRepository(AlertRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_by_user(self, user_id: UUID) -> list[Alert]:
        result = await self._session.execute(
            select(AlertORM).where(AlertORM.user_id == user_id).order_by(AlertORM.created_at.desc())
        )
        return [row.to_domain() for row in result.scalars()]

    async def create(self, alert: Alert) -> Alert:
        orm = AlertORM.from_domain(alert)
        self._session.add(orm)
        await self._session.commit()
        await self._session.refresh(orm)
        return orm.to_domain()

    async def get_by_id(self, alert_id: UUID) -> Alert | None:
        result = await self._session.execute(select(AlertORM).where(AlertORM.id == alert_id))
        row = result.scalar_one_or_none()
        return row.to_domain() if row else None

    async def update(self, alert: Alert) -> Alert:
        orm = AlertORM.from_domain(alert)
        merged = await self._session.merge(orm)
        await self._session.commit()
        return merged.to_domain()

    async def delete(self, alert_id: UUID, user_id: UUID) -> bool:
        result = await self._session.execute(
            select(AlertORM).where(
                AlertORM.id == alert_id,
                AlertORM.user_id == user_id,
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            return False
        await self._session.delete(row)
        await self._session.commit()
        return True

    async def list_untriggered(self) -> list[Alert]:
        """All untriggered alerts across all users — used by the price check job."""
        result = await self._session.execute(
            select(AlertORM)
            .where(AlertORM.triggered.is_(False))
            .order_by(AlertORM.created_at.desc())
        )
        return [row.to_domain() for row in result.scalars()]
