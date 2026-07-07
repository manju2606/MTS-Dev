"""Weekly market-sentiment forecast API -- see app/services/sentiment_forecast_service.py
for the (deliberately simple, auditable) forecasting formula.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import CurrentUser, require_role
from app.domain.models.user import UserRole
from app.services import sentiment_forecast_service as service

_admin_only = Depends(require_role(UserRole.ADMIN))

router = APIRouter(prefix="/sentiment-forecast", tags=["sentiment-forecast"])


@router.get("/current-week")
async def current_week(current_user: CurrentUser) -> dict:
    view = await service.get_week_view()
    if not view:
        raise HTTPException(status_code=404, detail="No forecast generated for this week yet")
    return view


@router.get("/week/{week_start}")
async def week(week_start: str, current_user: CurrentUser) -> dict:
    view = await service.get_week_view(week_start)
    if not view:
        raise HTTPException(status_code=404, detail=f"No forecast found for week {week_start}")
    return view


@router.get("/history")
async def history(
    current_user: CurrentUser,
    limit: int = Query(default=12, ge=1, le=52),
) -> list[dict]:
    return await service.get_forecast_history(limit=limit)


@router.post("/generate", dependencies=[_admin_only])
async def generate(current_user: CurrentUser) -> dict:
    forecast = await service.generate_weekly_forecast()
    view = await service.get_week_view(forecast.week_start)
    assert view is not None
    return view


@router.post("/snapshot", dependencies=[_admin_only])
async def snapshot(current_user: CurrentUser) -> dict:
    snap = await service.compute_daily_snapshot()
    from dataclasses import asdict

    doc = asdict(snap)
    doc["id"] = str(doc["id"])
    doc["created_at"] = snap.created_at.isoformat()
    return doc
