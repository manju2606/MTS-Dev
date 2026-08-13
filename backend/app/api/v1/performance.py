"""Cross-engine Performance dashboard -- win/loss stats across every
AI-generated trading signal source (MCX, Golden Stock, BTST, Stock of
the Day, paper trades, Chartink, Golden Egg). See
services/performance_dashboard_service.py for the aggregation logic and
which sources actually have resolved outcome data today.
"""

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser

router = APIRouter(prefix="/performance", tags=["performance"])


@router.get("/summary")
async def get_summary(
    current_user: CurrentUser,
    days: int | None = Query(default=None, ge=1, le=3650, description="Omit for all-time"),
) -> dict:
    from app.services.performance_dashboard_service import get_performance_summary

    return await get_performance_summary(current_user.id, days)
