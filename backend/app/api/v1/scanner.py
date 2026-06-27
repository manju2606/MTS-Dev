from dataclasses import asdict

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, MarketDataDep, WatchlistDep
from app.domain.models.watchlist import WatchlistItem

router = APIRouter(prefix="/scanner", tags=["scanner"])


def _normalise(symbol: str) -> str:
    upper = symbol.upper()
    return upper if (upper.endswith(".NS") or upper.endswith(".BO")) else f"{upper}.NS"


class WatchlistAddRequest(BaseModel):
    symbol: str


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
async def get_watchlist(current_user: CurrentUser, repo: WatchlistDep) -> list[dict]:
    items = await repo.list_by_user(current_user.id)
    return [asdict(item) for item in items]


@router.post("/watchlist", status_code=status.HTTP_201_CREATED)
async def add_to_watchlist(
    body: WatchlistAddRequest,
    current_user: CurrentUser,
    repo: WatchlistDep,
    market_data: MarketDataDep,
) -> dict:
    try:
        quote = await market_data.get_quote(body.symbol)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    item = WatchlistItem(user_id=current_user.id, symbol=quote.symbol, exchange=quote.exchange)
    try:
        saved = await repo.add(item)
        return asdict(saved)
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{quote.symbol}' is already in your watchlist",
        ) from exc


@router.delete("/watchlist/{symbol}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_from_watchlist(
    symbol: str, current_user: CurrentUser, repo: WatchlistDep
) -> None:
    normalised = _normalise(symbol)
    removed = await repo.remove(current_user.id, normalised)
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"'{normalised}' not found in your watchlist",
        )
