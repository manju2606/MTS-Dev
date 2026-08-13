"""Repository for Chartink scan-link polling config -- see
app/domain/models/chartink_scan_link.py. Same "concrete class, no ABC"
precedent as chartink_repo.py.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.chartink_scan_link import ChartinkScanLink
from app.infra.db.models import ChartinkScanLinkORM


class SQLChartinkScanLinkRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, link: ChartinkScanLink) -> ChartinkScanLink:
        self._session.add(ChartinkScanLinkORM.from_domain(link))
        await self._session.commit()
        return link

    async def list_all(self) -> list[ChartinkScanLink]:
        result = await self._session.execute(
            select(ChartinkScanLinkORM).order_by(ChartinkScanLinkORM.created_at.desc())
        )
        return [row.to_domain() for row in result.scalars()]

    async def list_enabled(self) -> list[ChartinkScanLink]:
        result = await self._session.execute(
            select(ChartinkScanLinkORM).where(ChartinkScanLinkORM.enabled.is_(True))
        )
        return [row.to_domain() for row in result.scalars()]

    async def get_by_id(self, link_id: UUID) -> ChartinkScanLink | None:
        row = await self._session.get(ChartinkScanLinkORM, link_id)
        return row.to_domain() if row else None

    async def update(self, link_id: UUID, patch: dict) -> ChartinkScanLink | None:
        row = await self._session.get(ChartinkScanLinkORM, link_id)
        if row is None:
            return None
        for key, value in patch.items():
            setattr(row, key, value)
        await self._session.commit()
        return row.to_domain()

    async def delete(self, link_id: UUID) -> bool:
        row = await self._session.get(ChartinkScanLinkORM, link_id)
        if row is None:
            return False
        await self._session.delete(row)
        await self._session.commit()
        return True

    async def mark_polled(
        self, link_id: UUID, status: str, count: int, polled_at: datetime | None = None
    ) -> None:
        row = await self._session.get(ChartinkScanLinkORM, link_id)
        if row is None:
            return
        row.last_polled_at = polled_at or datetime.utcnow()
        row.last_poll_status = status[:500]
        row.last_poll_count = count
        await self._session.commit()
