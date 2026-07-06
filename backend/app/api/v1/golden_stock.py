"""Golden Stock — Intraday API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import CurrentUser, require_role
from app.domain.models.user import UserRole

router = APIRouter(prefix="/golden-stock", tags=["golden-stock"])

_admin_only = Depends(require_role(UserRole.ADMIN))


@router.get("/latest")
async def get_latest(_: CurrentUser) -> dict:
    """Return the most recent BTST scan, or 404 if none exists yet."""
    from app.infra.db.repositories.golden_stock_repo import GoldenStockRepository
    repo = GoldenStockRepository()
    doc = await repo.get_latest_scan()
    if doc is None:
        raise HTTPException(status_code=404, detail="No Intraday scan found. Run a scan first.")
    return doc


@router.get("/history")
async def get_history(
    _: CurrentUser,
    limit: int = Query(default=30, ge=1, le=100),
) -> list[dict]:
    """Return metadata for recent BTST scans (no picks detail), most recent first."""
    from app.infra.db.repositories.golden_stock_repo import GoldenStockRepository
    repo = GoldenStockRepository()
    return await repo.get_history(limit=limit)


@router.get("/history/{date_str}")
async def get_scan_by_date(date_str: str, _: CurrentUser) -> dict:
    """Return the full BTST scan document for a specific date (YYYY-MM-DD)."""
    from app.infra.db.repositories.golden_stock_repo import GoldenStockRepository
    repo = GoldenStockRepository()
    doc = await repo.get_scan_by_date(date_str)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"No Intraday scan found for date {date_str}")
    return doc


@router.post("/scan", dependencies=[_admin_only])
async def trigger_scan(_: CurrentUser) -> dict:
    """Manually trigger a BTST scan (admin only). Runs the full two-pass scan."""
    import dataclasses

    from app.services.golden_stock_service import run_and_save_golden_stock
    scan = await run_and_save_golden_stock()
    doc = dataclasses.asdict(scan)
    return doc


@router.get("/performance")
async def get_performance(_: CurrentUser) -> dict:
    """Return accuracy statistics for resolved BTST picks (hit rate, avg return)."""
    from app.infra.db.repositories.golden_stock_repo import GoldenStockRepository
    repo = GoldenStockRepository()
    return await repo.get_performance_stats()
