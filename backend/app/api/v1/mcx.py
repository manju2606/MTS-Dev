"""MCX Natural Gas — live quote (via connected Zerodha Kite account) and
paper trading (reuses the same Trade domain model as equity paper trading)."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, TradeDep, require_role
from app.domain.models.trade import TradeSignal, TradeStatus
from app.domain.models.user import UserRole

_trader_or_admin = Depends(require_role(UserRole.ADMIN, UserRole.TRADER))

router = APIRouter(prefix="/mcx", tags=["mcx"])


@router.get("/ng/quote")
async def ng_quote(current_user: CurrentUser) -> dict:
    from app.services.mcx_service import McxNotConnectedError, get_ng_quote

    try:
        return await get_ng_quote(str(current_user.id))
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MCX quote unavailable: {exc}",
        ) from exc


class PlaceNgTradeRequest(BaseModel):
    signal: TradeSignal
    lots: int = Field(ge=1)
    stop_loss: float = Field(gt=0)
    target: float = Field(gt=0)
    limit_price: float | None = Field(default=None, gt=0)


@router.post(
    "/ng/trades", status_code=http_status.HTTP_201_CREATED, dependencies=[_trader_or_admin]
)
async def place_ng_trade(
    body: PlaceNgTradeRequest, current_user: CurrentUser, repo: TradeDep
) -> dict:
    from app.services.mcx_service import McxNotConnectedError, place_ng_trade

    try:
        return await place_ng_trade(
            str(current_user.id),
            repo,
            body.signal,
            body.lots,
            body.stop_loss,
            body.target,
            body.limit_price,
        )
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get("/ng/trades")
async def list_ng_trades(
    current_user: CurrentUser,
    repo: TradeDep,
    trade_status: TradeStatus | None = None,
) -> list[dict]:
    from app.services.mcx_service import list_ng_trades

    return await list_ng_trades(str(current_user.id), repo, trade_status)


@router.post("/ng/trades/{trade_id}/close", dependencies=[_trader_or_admin])
async def close_ng_trade(
    trade_id: UUID,
    current_user: CurrentUser,
    repo: TradeDep,
    exit_price: float | None = None,
) -> dict:
    from app.services.mcx_service import McxNotConnectedError, close_ng_trade

    try:
        return await close_ng_trade(str(current_user.id), repo, trade_id, exit_price)
    except LookupError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
