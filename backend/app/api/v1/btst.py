"""BTST (Buy Today, Sell Tomorrow) API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import CurrentUser, require_role
from app.domain.models.user import UserRole

router = APIRouter(prefix="/btst", tags=["btst"])

_admin_only = Depends(require_role(UserRole.ADMIN))


@router.get("/latest")
async def get_latest(_: CurrentUser) -> dict:
    """Return the most recent BTST scan, or 404 if none exists yet."""
    from app.infra.db.repositories.btst_repo import BTSTRepository

    repo = BTSTRepository()
    doc = await repo.get_latest_scan()
    if doc is None:
        raise HTTPException(status_code=404, detail="No BTST scan found. Run a scan first.")
    return doc


@router.get("/history")
async def get_history(
    _: CurrentUser,
    limit: int = Query(default=30, ge=1, le=100),
) -> list[dict]:
    """Return metadata for recent BTST scans (no picks detail), most recent first."""
    from app.infra.db.repositories.btst_repo import BTSTRepository

    repo = BTSTRepository()
    return await repo.get_history(limit=limit)


@router.get("/history/{date_str}")
async def get_scan_by_date(date_str: str, _: CurrentUser) -> dict:
    """Return the full BTST scan document for a specific date (YYYY-MM-DD)."""
    from app.infra.db.repositories.btst_repo import BTSTRepository

    repo = BTSTRepository()
    doc = await repo.get_scan_by_date(date_str)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"No BTST scan found for date {date_str}")
    return doc


@router.post("/scan", dependencies=[_admin_only])
async def trigger_scan(_: CurrentUser) -> dict:
    """Manually trigger a BTST scan (admin only). Runs the full scan pipeline."""
    import dataclasses

    from app.services.btst_service import run_and_save_btst

    scan = await run_and_save_btst()
    return dataclasses.asdict(scan)


@router.get("/performance")
async def get_performance(_: CurrentUser) -> dict:
    """Return accuracy statistics for resolved BTST picks (hit rate, avg return)."""
    from app.infra.db.repositories.btst_repo import BTSTRepository

    repo = BTSTRepository()
    return await repo.get_performance_stats()
