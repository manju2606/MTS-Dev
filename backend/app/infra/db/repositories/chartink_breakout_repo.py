"""Repository for Chartink breakout alerts -- see
app/domain/models/chartink_breakout_alert.py.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.chartink_breakout_alert import ChartinkBreakoutAlert
from app.infra.db.models import ChartinkBreakoutAlertORM


class SQLChartinkBreakoutAlertRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, alert: ChartinkBreakoutAlert) -> ChartinkBreakoutAlert:
        self._session.add(ChartinkBreakoutAlertORM.from_domain(alert))
        await self._session.commit()
        return alert

    async def list_recent(self, limit: int = 100) -> list[ChartinkBreakoutAlert]:
        result = await self._session.execute(
            select(ChartinkBreakoutAlertORM)
            .order_by(ChartinkBreakoutAlertORM.created_at.desc())
            .limit(limit)
        )
        return [row.to_domain() for row in result.scalars()]
