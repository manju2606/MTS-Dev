"""Watchlist Pick History API routes — read-only records of SotD/BTST/Golden
Stock picks' price/P&L since the day they were announced."""

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import CurrentUser
from app.infra.db.repositories.watchlist_history_repo import WatchlistHistoryRepository

router = APIRouter(prefix="/watchlist-history", tags=["watchlist-history"])


@router.get("/picks")
async def list_picks(
    _: CurrentUser,
    source: str | None = Query(default=None),
    active: bool | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
) -> list[dict]:
    """List tracked picks, most recently announced first. Each entry
    includes its full daily snapshots array for client-side week/month
    rollup."""
    repo = WatchlistHistoryRepository()
    return await repo.list_picks(
        source=source, active=active, start_date=start_date, end_date=end_date, limit=limit
    )


@router.get("/picks/{pick_id}")
async def get_pick(pick_id: str, _: CurrentUser) -> dict:
    """A single tracked pick with its full snapshot history."""
    repo = WatchlistHistoryRepository()
    pick = await repo.get_by_id(pick_id)
    if pick is None:
        raise HTTPException(status_code=404, detail="Pick not found")
    return pick
