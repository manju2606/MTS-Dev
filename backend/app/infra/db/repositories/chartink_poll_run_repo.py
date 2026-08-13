"""Repository for Chartink scan-link poll run history -- see
app/domain/models/chartink_poll_run.py.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.chartink_poll_run import ChartinkPollRun
from app.infra.db.models import ChartinkPollRunORM


class SQLChartinkPollRunRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, run: ChartinkPollRun) -> ChartinkPollRun:
        self._session.add(ChartinkPollRunORM.from_domain(run))
        await self._session.commit()
        return run

    async def list_recent(self, scan_link_id: UUID, limit: int = 20) -> list[ChartinkPollRun]:
        result = await self._session.execute(
            select(ChartinkPollRunORM)
            .where(ChartinkPollRunORM.scan_link_id == scan_link_id)
            .order_by(ChartinkPollRunORM.polled_at.desc())
            .limit(limit)
        )
        return [row.to_domain() for row in result.scalars()]
