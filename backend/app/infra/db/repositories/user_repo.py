from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.interfaces.repositories import UserRepository
from app.domain.models.user import User
from app.infra.db.models import UserORM


class SQLUserRepository(UserRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, user_id: UUID) -> User | None:
        result = await self._session.execute(select(UserORM).where(UserORM.id == user_id))
        row = result.scalar_one_or_none()
        return row.to_domain() if row else None

    async def get_by_email(self, email: str) -> User | None:
        result = await self._session.execute(select(UserORM).where(UserORM.email == email))
        row = result.scalar_one_or_none()
        return row.to_domain() if row else None

    async def create(self, user: User) -> User:
        orm = UserORM.from_domain(user)
        self._session.add(orm)
        await self._session.commit()
        await self._session.refresh(orm)
        return orm.to_domain()

    async def update(self, user: User) -> User:
        orm = UserORM.from_domain(user)
        merged = await self._session.merge(orm)
        await self._session.commit()
        return merged.to_domain()
