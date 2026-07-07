from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.api_key import ApiKey
from app.infra.db.models import ApiKeyORM


class SQLApiKeyRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create(self, key: ApiKey) -> ApiKey:
        orm = ApiKeyORM.from_domain(key)
        self._db.add(orm)
        await self._db.commit()
        await self._db.refresh(orm)
        return orm.to_domain()

    async def list_by_user(self, user_id: UUID) -> list[ApiKey]:
        result = await self._db.execute(
            select(ApiKeyORM)
            .where(ApiKeyORM.user_id == user_id, ApiKeyORM.revoked.is_(False))
            .order_by(ApiKeyORM.created_at.desc())
        )
        return [row.to_domain() for row in result.scalars()]

    async def get_by_hash(self, key_hash: str) -> ApiKey | None:
        result = await self._db.execute(select(ApiKeyORM).where(ApiKeyORM.key_hash == key_hash))
        row = result.scalar_one_or_none()
        return row.to_domain() if row else None

    async def revoke(self, key_id: UUID, user_id: UUID) -> bool:
        result = await self._db.execute(
            update(ApiKeyORM)
            .where(ApiKeyORM.id == key_id, ApiKeyORM.user_id == user_id)
            .values(revoked=True)
            .returning(ApiKeyORM.id)
        )
        await self._db.commit()
        return result.scalar_one_or_none() is not None

    async def touch_last_used(self, key_id: UUID) -> None:
        await self._db.execute(
            update(ApiKeyORM).where(ApiKeyORM.id == key_id).values(last_used_at=datetime.utcnow())
        )
        await self._db.commit()
