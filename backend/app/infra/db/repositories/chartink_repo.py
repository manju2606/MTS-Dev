"""Repository for Chartink scan candidates.

A concrete class, not behind an ABC in domain/interfaces/repositories.py --
same precedent as zerodha_auto_login_repo.py/api_key_repo.py: this is a
single-consumer, feature-specific repo (the Chartink webhook pipeline), not
one of the core Phase-1/2 entities that interface abstracts over.
"""

from uuid import UUID

from sqlalchemy import func, select
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

    async def get_last_n_batches(
        self, scan_name: str, n: int
    ) -> list[list[ChartinkCandidate]]:
        """Up to the last n batches for a scan_name, most-recent-first, each
        a full list of candidates -- grouped by batch_id, not received_at
        (see ChartinkCandidate.batch_id's docstring for why). Fewer than n
        lists come back if there isn't that much history yet."""
        batch_order = (
            select(
                ChartinkCandidateORM.batch_id,
                func.min(ChartinkCandidateORM.received_at).label("batch_time"),
            )
            .where(
                ChartinkCandidateORM.scan_name == scan_name,
                ChartinkCandidateORM.batch_id.is_not(None),
            )
            .group_by(ChartinkCandidateORM.batch_id)
            .order_by(func.min(ChartinkCandidateORM.received_at).desc())
            .limit(n)
        )
        batch_result = await self._session.execute(batch_order)
        batch_ids = [row.batch_id for row in batch_result]

        batches: list[list[ChartinkCandidate]] = []
        for batch_id in batch_ids:
            result = await self._session.execute(
                select(ChartinkCandidateORM).where(ChartinkCandidateORM.batch_id == batch_id)
            )
            batches.append([row.to_domain() for row in result.scalars()])
        return batches

    async def get_latest_two_batches(
        self, scan_name: str
    ) -> tuple[list[ChartinkCandidate], list[ChartinkCandidate]]:
        """(latest_batch, previous_batch) for a scan_name -- either list is
        empty if there haven't been that many batches yet."""
        batches = await self.get_last_n_batches(scan_name, 2)
        latest = batches[0] if len(batches) > 0 else []
        previous = batches[1] if len(batches) > 1 else []
        return latest, previous

    async def detect_new_breakouts(self, scan_name: str, streak_threshold: int = 3) -> list[str]:
        """Symbols whose consecutive-batch streak *just* reached
        streak_threshold as of the latest batch -- i.e. present in each of
        the last streak_threshold batches, but either there's no batch
        before that window or the symbol wasn't in it. That "just crossed"
        framing (as opposed to "present in the last N batches", which
        would also match every later poll once a streak is already past
        the threshold) is what keeps this a one-time event per streak
        instead of re-firing on every subsequent appearance."""
        batches = await self.get_last_n_batches(scan_name, streak_threshold + 1)
        if len(batches) < streak_threshold:
            return []

        batch_symbol_sets = [{c.symbol for c in batch} for batch in batches]
        latest_symbols = batch_symbol_sets[0]

        breakouts = []
        for symbol in latest_symbols:
            in_window = all(symbol in batch_symbol_sets[i] for i in range(streak_threshold))
            if not in_window:
                continue
            # No (streak_threshold+1)-th batch to check against means the
            # streak can't be longer than streak_threshold anyway.
            already_longer = (
                len(batch_symbol_sets) > streak_threshold
                and symbol in batch_symbol_sets[streak_threshold]
            )
            if not already_longer:
                breakouts.append(symbol)
        return breakouts

    async def compare_latest_batches(self, scan_name: str) -> dict:
        """Part 3 (Comparison Logic): diff the two most recent scan-alert
        batches for scan_name by symbol -- new (in latest, not previous),
        persistent (in both), dropped (in previous, not latest)."""
        latest, previous = await self.get_latest_two_batches(scan_name)
        latest_by_symbol = {c.symbol: c for c in latest}
        previous_symbols = {c.symbol for c in previous}
        latest_symbols = set(latest_by_symbol)

        new = [latest_by_symbol[s] for s in latest_symbols - previous_symbols]
        persistent = [latest_by_symbol[s] for s in latest_symbols & previous_symbols]
        dropped = [c for c in previous if c.symbol not in latest_symbols]

        return {
            "scan_name": scan_name,
            "latest_received_at": latest[0].received_at.isoformat() if latest else None,
            "previous_received_at": previous[0].received_at.isoformat() if previous else None,
            "new": new,
            "persistent": persistent,
            "dropped": dropped,
        }
