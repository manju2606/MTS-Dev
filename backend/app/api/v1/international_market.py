"""International Market dashboard -- ranks major global indices (S&P 500,
Nasdaq, FTSE 100, Nikkei 225, etc.) by a derived Trend/AI Score/
Confidence. See app/services/international_market_service.py for the
derivation and its explicit limitations vs. MCX's fuller AI Score."""

from fastapi import APIRouter, HTTPException
from fastapi import status as http_status

from app.api.deps import CurrentUser

router = APIRouter(prefix="/international-market", tags=["international-market"])


@router.get("/dashboard")
async def international_market_dashboard(current_user: CurrentUser) -> dict:
    from app.services.international_market_service import get_dashboard

    try:
        return await get_dashboard()
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"International Market dashboard unavailable: {exc}",
        ) from exc


@router.get("/predict")
async def international_market_predict(current_user: CurrentUser, code: str) -> dict:
    from app.services.global_indices_prediction_service import get_all_predictions

    try:
        return await get_all_predictions(code)
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"International Market prediction unavailable: {exc}",
        ) from exc
