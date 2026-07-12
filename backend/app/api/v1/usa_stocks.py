"""USA Stocks quotes + OHLC candles + price prediction, all via yfinance
-- see app/services/usa_stocks_service.py and
usa_stocks_prediction_service.py. No paper trading/AI score yet (unlike
MCX); USD only, no INR conversion (unlike Crypto)."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi import status as http_status

from app.api.deps import CurrentUser

router = APIRouter(prefix="/usa-stocks", tags=["usa-stocks"])

UsaStockCode = Literal[
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B", "LLY", "AVGO",
    "JPM", "V", "UNH", "XOM", "MA", "JNJ", "PG", "HD", "COST", "MRK",
    "ABBV", "CVX", "CRM", "BAC", "PEP", "KO", "ADBE", "WMT", "NFLX", "AMD",
    "TMO", "MCD", "LIN", "CSCO", "ABT", "ACN", "ORCL", "DIS", "PM", "WFC",
    "DHR", "VZ", "TXN", "INTU", "AMGN", "CAT", "IBM", "GE", "NOW", "QCOM",
]
UsaStockPeriod = Literal["1m", "5m", "15m", "30m", "1h", "1D", "1W", "1M"]


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
    current_user: CurrentUser, code: UsaStockCode = "AAPL", period: UsaStockPeriod = "30m"
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
    current_user: CurrentUser, code: UsaStockCode = "AAPL", period: UsaStockPeriod = "30m"
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
