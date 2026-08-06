"""Golden Egg — daily single-pick API routes.

See app/services/golden_egg_service.py for the 09:15 IST scan/email/persist
pipeline, and golden_egg_intraday_prediction_service.py for the 1h forecast
(day/week/month come from the existing /forecast/{symbol} routes -- see
today()'s note below).
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import CurrentUser, require_role
from app.domain.models.user import UserRole

router = APIRouter(prefix="/golden-egg", tags=["golden-egg"])

_admin_only = Depends(require_role(UserRole.ADMIN))


@router.get("/today")
async def get_today(_: CurrentUser) -> dict:
    """Most recent Golden Egg pick. Frontend also calls
    GET /forecast/{symbol} and GET /forecast/{symbol}/history with this
    pick's symbol for the day/week/month predictions -- those are the
    existing ML-ensemble forecast, reused as-is rather than duplicated
    here."""
    from app.infra.db.repositories.golden_egg_repo import GoldenEggRepository

    repo = GoldenEggRepository()
    doc = await repo.get_latest()
    if doc is None:
        raise HTTPException(status_code=404, detail="No Golden Egg pick yet. Run a scan first.")
    return doc


@router.get("/history")
async def get_history(_: CurrentUser, limit: int = Query(default=30, ge=1, le=100)) -> list[dict]:
    from app.infra.db.repositories.golden_egg_repo import GoldenEggRepository

    repo = GoldenEggRepository()
    return await repo.get_history(limit=limit)


@router.get("/history/{date_str}")
async def get_by_date(date_str: str, _: CurrentUser) -> dict:
    from app.infra.db.repositories.golden_egg_repo import GoldenEggRepository

    repo = GoldenEggRepository()
    doc = await repo.get_by_date(date_str)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"No Golden Egg pick for date {date_str}")
    return doc


@router.post("/scan", dependencies=[_admin_only])
async def trigger_scan(_: CurrentUser) -> dict:
    """Manually trigger today's Golden Egg pick + email now (admin only)."""
    from app.services.golden_egg_service import send_golden_egg_email

    pick = await send_golden_egg_email()
    if pick is None:
        return {"pick": None, "message": "No candidate cleared the scanner's filters today."}
    import dataclasses

    return {"pick": dataclasses.asdict(pick)}


@router.get("/predict-1h")
async def predict_1h(_: CurrentUser) -> dict:
    """1-hour forecast for today's pick's symbol -- see
    golden_egg_intraday_prediction_service.py. 409 if there's no pick today
    (nothing to forecast)."""
    from app.infra.db.repositories.golden_egg_repo import GoldenEggRepository
    from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
    from app.services.golden_egg_intraday_prediction_service import get_1h_prediction

    egg_repo = GoldenEggRepository()
    doc = await egg_repo.get_latest()
    if doc is None or not doc.get("pick"):
        raise HTTPException(status_code=409, detail="No Golden Egg pick today to forecast.")

    symbol = doc["pick"]["symbol"]
    try:
        return await get_1h_prediction(symbol, McxPredictionRepository())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"1h prediction unavailable: {exc}") from exc
