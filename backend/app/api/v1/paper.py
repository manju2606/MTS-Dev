from dataclasses import asdict
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from fastapi import status as http_status
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, MarketDataDep, TradeDep
from app.domain.models.trade import Trade, TradeMode, TradeSignal, TradeStatus

router = APIRouter(prefix="/paper", tags=["paper-trading"])


def _trade_dict(trade: Trade) -> dict:
    d = asdict(trade)
    d["risk_reward_ratio"] = trade.risk_reward_ratio
    d["pnl"] = trade.pnl
    return d


class PlaceTradeRequest(BaseModel):
    symbol: str
    signal: TradeSignal
    stop_loss: float = Field(gt=0)
    target: float = Field(gt=0)
    quantity: int = Field(ge=1)


@router.post("/trades", status_code=http_status.HTTP_201_CREATED)
async def place_trade(
    body: PlaceTradeRequest,
    current_user: CurrentUser,
    repo: TradeDep,
    market_data: MarketDataDep,
) -> dict:
    try:
        quote = await market_data.get_quote(body.symbol)
    except ValueError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    entry = quote.price

    if body.signal == TradeSignal.BUY:
        if body.stop_loss >= entry:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"BUY stop_loss ({body.stop_loss}) must be below entry price ({entry})",
            )
        if body.target <= entry:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"BUY target ({body.target}) must be above entry price ({entry})",
            )
    else:
        if body.stop_loss <= entry:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"SELL stop_loss ({body.stop_loss}) must be above entry price ({entry})",
            )
        if body.target >= entry:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"SELL target ({body.target}) must be below entry price ({entry})",
            )

    trade = Trade(
        user_id=current_user.id,
        symbol=quote.symbol,
        exchange=quote.exchange,
        signal=body.signal,
        entry_price=entry,
        stop_loss=body.stop_loss,
        target=body.target,
        quantity=body.quantity,
        mode=TradeMode.PAPER,
        status=TradeStatus.OPEN,
        opened_at=datetime.utcnow(),
    )
    saved = await repo.create(trade)
    return _trade_dict(saved)


@router.get("/trades")
async def list_trades(
    current_user: CurrentUser,
    repo: TradeDep,
    trade_status: TradeStatus | None = Query(default=None, alias="status"),  # noqa: B008
) -> list[dict]:
    trades = await repo.list_by_user(current_user.id, trade_status)
    return [_trade_dict(t) for t in trades]


@router.get("/trades/{trade_id}")
async def get_trade(
    trade_id: UUID,
    current_user: CurrentUser,
    repo: TradeDep,
) -> dict:
    trade = await repo.get_by_id(trade_id)
    if not trade or trade.user_id != current_user.id:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Trade not found"
        )
    return _trade_dict(trade)


@router.post("/trades/{trade_id}/close")
async def close_trade(
    trade_id: UUID,
    current_user: CurrentUser,
    repo: TradeDep,
    market_data: MarketDataDep,
) -> dict:
    trade = await repo.get_by_id(trade_id)
    if not trade or trade.user_id != current_user.id:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Trade not found"
        )
    if trade.status != TradeStatus.OPEN:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=f"Trade is already {trade.status}",
        )

    try:
        quote = await market_data.get_quote(trade.symbol)
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Market data unavailable",
        ) from exc

    trade.exit_price = quote.price
    trade.closed_at = datetime.utcnow()
    trade.status = TradeStatus.CLOSED

    updated = await repo.update(trade)
    return _trade_dict(updated)
