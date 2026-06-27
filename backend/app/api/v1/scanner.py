from dataclasses import asdict

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, MarketDataDep

router = APIRouter(prefix="/scanner", tags=["scanner"])


@router.get("/quotes/{symbol}")
async def get_quote(symbol: str, current_user: CurrentUser, market_data: MarketDataDep) -> dict:
    try:
        quote = await market_data.get_quote(symbol)
        return asdict(quote)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


@router.get("/watchlist")
async def get_watchlist(current_user: CurrentUser) -> list:
    # TODO: persist watchlist per user in PostgreSQL
    return []
