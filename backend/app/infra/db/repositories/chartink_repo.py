"""Repository for Chartink scan candidates.

A concrete class, not behind an ABC in domain/interfaces/repositories.py --
same precedent as zerodha_auto_login_repo.py/api_key_repo.py: this is a
single-consumer, feature-specific repo (the Chartink webhook pipeline), not
one of the core Phase-1/2 entities that interface abstracts over.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.chartink_candidate import ChartinkCandidate
from app.infra.db.models import ChartinkCandidateORM


class SQLChartinkCandidateRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save_many(self, candidates: list[ChartinkCandidate]) -> None:
        """Bulk-persist every candidate from one webhook payload."""
        for candidate in candidates:
            self._session.add(ChartinkCandidateORM.from_domain(candidate))
        await self._session.commit()

    async def list_recent(
        self, scan_name: str | None = None, limit: int = 50
    ) -> list[ChartinkCandidate]:
        stmt = select(ChartinkCandidateORM).order_by(
            ChartinkCandidateORM.received_at.desc()
        )
        if scan_name:
            stmt = stmt.where(ChartinkCandidateORM.scan_name == scan_name)
        stmt = stmt.limit(limit)
        result = await self._session.execute(stmt)
        return [row.to_domain() for row in result.scalars()]

    async def list_today(self) -> list[ChartinkCandidate]:
        from datetime import UTC, datetime

        start_of_day = datetime.now(UTC).replace(
            hour=0, minute=0, second=0, microsecond=0, tzinfo=None
        )
        result = await self._session.execute(
            select(ChartinkCandidateORM)
            .where(ChartinkCandidateORM.received_at >= start_of_day)
            .order_by(ChartinkCandidateORM.received_at.desc())
        )
        return [row.to_domain() for row in result.scalars()]

    async def get_by_id(self, candidate_id: UUID) -> ChartinkCandidate | None:
        result = await self._session.execute(
            select(ChartinkCandidateORM).where(ChartinkCandidateORM.id == candidate_id)
        )
        row = result.scalar_one_or_none()
        return row.to_domain() if row else None
