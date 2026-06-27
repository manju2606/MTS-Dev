from fastapi import APIRouter

from app.api.deps import CurrentUser

router = APIRouter(prefix="/scanner", tags=["scanner"])


@router.get("/quotes/{symbol}")
async def get_quote(symbol: str, current_user: CurrentUser) -> dict:
    # TODO: integrate NSE/BSE data provider (e.g. yfinance, Angel One, Zerodha)
    return {"symbol": symbol.upper(), "status": "not_implemented"}


@router.get("/watchlist")
async def get_watchlist(current_user: CurrentUser) -> list:
    # TODO: persist watchlist per user in PostgreSQL
    return []
