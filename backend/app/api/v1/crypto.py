"""Crypto quotes, OHLC candles, and price prediction via CoinGecko's public
API -- see app/services/crypto_service.py and crypto_prediction_service.py.
No paper trading/AI score yet (unlike MCX)."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi import status as http_status

from app.api.deps import CurrentUser

router = APIRouter(prefix="/crypto", tags=["crypto"])

CryptoCoin = Literal["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE"]
CryptoHistoryDays = Literal["1", "7", "14", "30", "90", "180", "365"]
CryptoOhlcPeriod = Literal["30m", "1h", "4h", "8h", "4d"]


@router.get("/quotes")
async def crypto_quotes(current_user: CurrentUser) -> list[dict]:
    from app.services.crypto_service import get_quotes

    try:
        return await get_quotes()
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Crypto quotes unavailable: {exc}",
        ) from exc


@router.get("/history")
async def crypto_history(
    current_user: CurrentUser, coin: CryptoCoin = "BTC", days: CryptoHistoryDays = "1"
) -> list[dict]:
    from app.services.crypto_service import get_history

    try:
        return await get_history(coin, days)
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Crypto history unavailable: {exc}",
        ) from exc


@router.get("/ohlc")
async def crypto_ohlc(
    current_user: CurrentUser, coin: CryptoCoin = "BTC", period: CryptoOhlcPeriod = "30m"
) -> list[dict]:
    from app.services.crypto_service import get_ohlc

    try:
        return await get_ohlc(coin, period)
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Crypto OHLC unavailable: {exc}",
        ) from exc


@router.get("/predict")
async def crypto_predict(
    current_user: CurrentUser, coin: CryptoCoin = "BTC", period: CryptoOhlcPeriod = "30m"
) -> dict:
    from app.services.crypto_prediction_service import get_prediction

    try:
        return await get_prediction(coin, period)
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Crypto prediction unavailable: {exc}",
        ) from exc


@router.get("/ranked")
async def crypto_ranked(current_user: CurrentUser) -> dict:
    from app.services.crypto_prediction_service import get_ranked_predictions

    try:
        return await get_ranked_predictions()
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Crypto ranked prediction unavailable: {exc}",
        ) from exc
