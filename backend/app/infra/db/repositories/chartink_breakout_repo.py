"""Repository for Chartink breakout alerts -- see
app/domain/models/chartink_breakout_alert.py.
"""

from datetime import datetime
from uuid import UUID

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

    async def list_open(self) -> list[ChartinkBreakoutAlert]:
        """Every unresolved alert (status=OPEN, has entry/SL/target from
        the scorer) -- for resolve_breakout_alerts() to check against
        live price."""
        result = await self._session.execute(
            select(ChartinkBreakoutAlertORM).where(ChartinkBreakoutAlertORM.status == "OPEN")
        )
        return [row.to_domain() for row in result.scalars()]

    async def close(
        self, alert_id: UUID, status: str, exit_price: float, closed_at: datetime
    ) -> None:
        row = await self._session.get(ChartinkBreakoutAlertORM, alert_id)
        if row is None:
            return
        row.status = status
        row.exit_price = exit_price
        row.closed_at = closed_at
        await self._session.commit()

    async def list_all_since(self, since: datetime | None) -> list[ChartinkBreakoutAlert]:
        """Every alert (any status) created on or after `since` (all-time
        if None) -- for the cross-engine Performance dashboard, which
        needs every alert fired, not just resolved ones."""
        stmt = select(ChartinkBreakoutAlertORM)
        if since is not None:
            stmt = stmt.where(ChartinkBreakoutAlertORM.created_at >= since)
        result = await self._session.execute(stmt)
        return [row.to_domain() for row in result.scalars()]
