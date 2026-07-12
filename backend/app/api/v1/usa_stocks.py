"""USA Stocks quotes + OHLC candles + price prediction, all via yfinance
-- see app/services/usa_stocks_service.py and
usa_stocks_prediction_service.py. No paper trading/AI score yet (unlike
MCX); USD only, no INR conversion (unlike Crypto).

The tracked-stock list is the fixed base 50 (usa_stocks_service.
TRACKED_STOCKS) plus whatever's been added via POST /custom -- shared
across all users, not per-user, so `code` below is a plain str rather
than a fixed Literal (a Literal would 422-reject any custom-added ticker
before it ever reached the service layer's own validation)."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi import status as http_status
from pydantic import BaseModel

from app.api.deps import CurrentUser

router = APIRouter(prefix="/usa-stocks", tags=["usa-stocks"])

UsaStockPeriod = Literal["1m", "5m", "15m", "30m", "1h", "1D", "1W", "1M"]


class AddUsaStockRequest(BaseModel):
    code: str


@router.get("/quotes")
async def usa_stocks_quotes(current_user: CurrentUser) -> list[dict]:
    from app.services.usa_stocks_service import get_quotes

    try:
        return await get_quotes()
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"USA Stocks quotes unavailable: {exc}",
        ) from exc


@router.get("/ohlc")
async def usa_stocks_ohlc(
    current_user: CurrentUser, code: str = "AAPL", period: UsaStockPeriod = "30m"
) -> list[dict]:
    from app.services.usa_stocks_service import get_klines

    try:
        return await get_klines(code, period)
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"USA Stocks OHLC unavailable: {exc}",
        ) from exc


@router.get("/predict")
async def usa_stocks_predict(
    current_user: CurrentUser, code: str = "AAPL", period: UsaStockPeriod = "30m"
) -> dict:
    from app.services.usa_stocks_prediction_service import get_prediction

    try:
        return await get_prediction(code, period)
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"USA Stocks prediction unavailable: {exc}",
        ) from exc


@router.get("/ranked")
async def usa_stocks_ranked(current_user: CurrentUser) -> dict:
    from app.services.usa_stocks_prediction_service import get_ranked_predictions

    try:
        return await get_ranked_predictions()
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"USA Stocks ranked prediction unavailable: {exc}",
        ) from exc


@router.post("/custom")
async def add_usa_stock(current_user: CurrentUser, body: AddUsaStockRequest) -> dict:
    from app.services.usa_stocks_service import add_custom_stock

    try:
        return await add_custom_stock(body.code, added_by=str(current_user.id))
    except ValueError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not add USA stock: {exc}",
        ) from exc


@router.delete("/custom/{code}")
async def remove_usa_stock(current_user: CurrentUser, code: str) -> dict:
    from app.services.usa_stocks_service import remove_custom_stock

    await remove_custom_stock(code)
    return {"status": "ok", "code": code.upper()}
