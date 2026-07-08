"""DSWS — Daily Discovery Watchlist Summary API routes."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import CurrentUser, require_role
from app.domain.models.user import UserRole

router = APIRouter(prefix="/dsws", tags=["dsws"])

_admin_only = Depends(require_role(UserRole.ADMIN))


@router.get("/today")
async def get_today(_: CurrentUser) -> dict:
    """Return today's DSWS watchlist, or 404 if it hasn't been generated yet."""
    from datetime import datetime, timedelta, timezone

    from app.infra.db.repositories.dsws_repo import DswsRepository

    IST = timezone(timedelta(hours=5, minutes=30))
    today = datetime.now(IST).strftime("%Y-%m-%d")

    repo = DswsRepository()
    doc = await repo.get_scan_by_date(today)
    if doc is None:
        raise HTTPException(
            status_code=404, detail="No DSWS watchlist for today yet. Run /dsws/generate first."
        )
    return doc


@router.get("/history/{date_str}")
async def get_by_date(date_str: str, _: CurrentUser) -> dict:
    """Return the DSWS watchlist for a specific date (YYYY-MM-DD)."""
    from app.infra.db.repositories.dsws_repo import DswsRepository

    repo = DswsRepository()
    doc = await repo.get_scan_by_date(date_str)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"No DSWS watchlist found for date {date_str}")
    return doc


@router.get("/report")
async def get_report(
    _: CurrentUser,
    period: Literal["day", "week", "month"] = Query(default="day"),
    date: str | None = Query(default=None, description="YYYY-MM-DD, defaults to today (IST)"),
) -> dict:
    """Aggregate DSWS performance over a day/week/month ending on `date`."""
    from datetime import datetime, timedelta, timezone

    from app.services.dsws_service import get_report as _get_report

    IST = timezone(timedelta(hours=5, minutes=30))
    target_date = date or datetime.now(IST).strftime("%Y-%m-%d")
    return await _get_report(period, target_date)


@router.post("/generate", dependencies=[_admin_only])
async def trigger_generate(_: CurrentUser) -> dict:
    """Manually trigger today's DSWS watchlist generation (admin only).

    Append-only — safe to call repeatedly, existing picks for today are
    left untouched.
    """
    from app.services.dsws_service import generate_daily_watchlist

    return await generate_daily_watchlist()


@router.post("/track", dependencies=[_admin_only])
async def trigger_track(_: CurrentUser) -> dict:
    """Manually record a price checkpoint for today's DSWS picks (admin only)."""
    from app.services.dsws_service import track_checkpoint

    recorded = await track_checkpoint()
    return {"recorded": recorded}
