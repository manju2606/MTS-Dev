"""Daily snapshot of every row in the Global Natural Gas Symbols table (NG,
NGMINI, Henry Hub, Dutch TTF) -- see
app/infra/db/repositories/mcx_global_symbols_snapshot_repo.py. Same
Day/Week/Month history pattern as the NG Dashboard's own snapshot
(mcx_dashboard_snapshot_service.py), extended to all four rows instead of
just whichever single contract is currently selected.
"""

from __future__ import annotations

from datetime import timedelta

from app.infra.db.repositories.mcx_global_symbols_snapshot_repo import (
    McxGlobalSymbolsSnapshotRepository,
)
from app.services.mcx_global_symbols_service import get_global_symbols
from app.services.mcx_service import ist_now


async def build_and_save_global_symbols_snapshot(
    user_id: str, repo: McxGlobalSymbolsSnapshotRepository
) -> list[dict]:
    rows = await get_global_symbols(user_id)
    date_str = ist_now().date().isoformat()
    for row in rows:
        await repo.save_snapshot(user_id, row["key"], date_str, row)
    return rows


async def get_global_symbols_snapshot_range(
    user_id: str, days: int, repo: McxGlobalSymbolsSnapshotRepository
) -> list[dict]:
    end = ist_now().date()
    start = end - timedelta(days=days)
    return await repo.get_range(user_id, start.isoformat(), end.isoformat())
