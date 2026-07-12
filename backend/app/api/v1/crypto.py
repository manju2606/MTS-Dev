"""Crypto quotes + price history via CoinGecko's public API -- see
app/services/crypto_service.py. v1 scope: live quotes + a basic price
chart only, no AI score/predictions/paper-trading (unlike MCX)."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi import status as http_status

from app.api.deps import CurrentUser

router = APIRouter(prefix="/crypto", tags=["crypto"])

CryptoCoin = Literal["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE"]
CryptoHistoryDays = Literal["1", "7", "14", "30", "90", "180", "365"]


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
