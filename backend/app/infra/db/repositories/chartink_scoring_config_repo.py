"""Repository for the Chartink Signal Engine's editable scoring config.

Single global row (id=1) -- see ChartinkScoringConfig for why this can't be
a per-user setting the way RiskConfig is. Same "concrete class, no ABC"
precedent as chartink_repo.py.
"""

from dataclasses import replace

from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.chartink_scoring_config import ChartinkScoringConfig
from app.infra.db.models import ChartinkScoringConfigORM

_ROW_ID = 1


class SQLChartinkScoringConfigRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self) -> ChartinkScoringConfig:
        """Falls back to the dataclass defaults when no row has been saved
        yet -- the scoring service always has *something* to score with,
        without needing a migration data-seed step."""
        row = await self._session.get(ChartinkScoringConfigORM, _ROW_ID)
        return row.to_domain() if row else ChartinkScoringConfig()

    async def update(self, patch: dict[str, float]) -> ChartinkScoringConfig:
        row = await self._session.get(ChartinkScoringConfigORM, _ROW_ID)
        current = row.to_domain() if row else ChartinkScoringConfig()
        updated = replace(current, **patch)
        if row is None:
            self._session.add(ChartinkScoringConfigORM.from_domain(updated))
        else:
            for key, value in patch.items():
                setattr(row, key, value)
        await self._session.commit()
        return updated
