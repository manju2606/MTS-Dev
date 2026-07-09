"""MCX Natural Gas / Natural Gas Mini — live quote (via connected Zerodha
Kite account) and paper trading (reuses the same Trade domain model as
equity paper trading). Routes stay under /mcx/ng/* for backward compat;
a `contract` query param ("NG" or "NGMINI") selects which instrument."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, TradeDep, require_role
from app.domain.models.trade import TradeSignal, TradeStatus
from app.domain.models.user import UserRole

_trader_or_admin = Depends(require_role(UserRole.ADMIN, UserRole.TRADER))

router = APIRouter(prefix="/mcx", tags=["mcx"])

McxContract = Literal["NG", "NGMINI"]


@router.get("/ng/quote")
async def ng_quote(current_user: CurrentUser, contract: McxContract = "NG") -> dict:
    from app.services.mcx_service import McxNotConnectedError, get_quote

    try:
        return await get_quote(str(current_user.id), contract)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MCX quote unavailable: {exc}",
        ) from exc


@router.get("/ng/history")
async def ng_history(
    current_user: CurrentUser, period: str = "1D", contract: McxContract = "NG"
) -> list[dict]:
    from app.services.mcx_service import McxNotConnectedError, get_history

    try:
        return await get_history(str(current_user.id), period, contract)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MCX history unavailable: {exc}",
        ) from exc


@router.get("/ng/ai-score")
async def ng_ai_score(
    current_user: CurrentUser,
    direction: TradeSignal = TradeSignal.BUY,
    capital: float = 100_000.0,
    contract: McxContract = "NG",
) -> dict:
    """NG-AI Pro v1 rule-based confidence score -- see
    app/services/mcx_ai_score_service.py for the full category breakdown
    and what's excluded (Volume Profile/Delta, bid/ask imbalance, news
    filter -- all need data this app doesn't have yet)."""
    from app.services.mcx_ai_score_service import compute_ng_ai_score
    from app.services.mcx_service import McxNotConnectedError

    try:
        return await compute_ng_ai_score(str(current_user.id), direction.value, capital, contract)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI score unavailable: {exc}",
        ) from exc


@router.get("/ng/predict")
async def ng_predict(
    current_user: CurrentUser, period: str = "15m", contract: McxContract = "NG"
) -> dict:
    """Short-horizon local price forecast (EMA slope + momentum + ATR cone)
    for the chart's selected timeframe, plus a rolling accuracy tracker --
    see app/services/mcx_prediction_service.py for what this is (and isn't:
    not Google TimesFM -- see that module's docstring for why)."""
    from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
    from app.services.mcx_prediction_service import get_prediction
    from app.services.mcx_service import McxNotConnectedError

    try:
        repo = McxPredictionRepository()
        return await get_prediction(str(current_user.id), contract, period, repo)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MCX prediction unavailable: {exc}",
        ) from exc


@router.get("/ng/range-stats")
async def ng_range_stats(current_user: CurrentUser, contract: McxContract = "NG") -> dict:
    """Day/week/month high-low for the front-month contract -- powers the
    DH1-3/DL1-3 chart reference lines (see mcx_service.get_range_stats)."""
    from app.services.mcx_service import McxNotConnectedError, get_range_stats

    try:
        return await get_range_stats(str(current_user.id), contract)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MCX range stats unavailable: {exc}",
        ) from exc


@router.get("/ng/trend")
async def ng_trend(current_user: CurrentUser, contract: McxContract = "NG") -> dict:
    """Multi-timeframe trend ladder (1m/5m/15m/1h/1D/1W) with regime-change
    detection -- see app/services/mcx_trend_service.py."""
    from app.services.mcx_service import McxNotConnectedError
    from app.services.mcx_trend_service import compute_trend_ladder

    try:
        return await compute_trend_ladder(str(current_user.id), contract)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Trend ladder unavailable: {exc}",
        ) from exc


class PlaceNgTradeRequest(BaseModel):
    signal: TradeSignal
    lots: int = Field(ge=1)
    stop_loss: float = Field(gt=0)
    target: float = Field(gt=0)
    limit_price: float | None = Field(default=None, gt=0)
    contract: McxContract = "NG"


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
            body.contract,
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
