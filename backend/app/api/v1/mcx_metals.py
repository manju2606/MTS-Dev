"""MCX Base & Precious Metals — live quote (via connected Zerodha Kite
account) and paper trading (reuses the same Trade domain model as equity
paper trading). Sibling router to mcx.py (Natural Gas); a `contract` query
param selects which of the 17 tracked variants (see
mcx_metals_service.MCX_METALS_CONTRACTS)."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, TradeDep, require_role
from app.domain.models.trade import TradeSignal, TradeStatus
from app.domain.models.user import UserRole

_trader_or_admin = Depends(require_role(UserRole.ADMIN, UserRole.TRADER))

router = APIRouter(prefix="/mcx/metals", tags=["mcx"])

McxMetalsContract = Literal[
    "ALUMINIUM", "ALUMINI", "COPPER", "LEAD", "LEADMINI", "NICKEL", "ZINC", "ZINCMINI",
    "GOLD", "GOLDMINI", "GOLDTEN", "GOLDGUINEA", "GOLDPETAL",
    "SILVER", "SILVERMINI", "SILVERMICRO", "SILVER100",
]


@router.get("/quote")
async def metal_quote(current_user: CurrentUser, contract: McxMetalsContract = "GOLD") -> dict:
    from app.services.mcx_metals_service import get_metal_quote
    from app.services.mcx_service import McxNotConnectedError

    try:
        return await get_metal_quote(str(current_user.id), contract)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MCX quote unavailable: {exc}",
        ) from exc


@router.get("/history")
async def metal_history(
    current_user: CurrentUser, period: str = "1D", contract: McxMetalsContract = "GOLD"
) -> list[dict]:
    from app.services.mcx_metals_service import get_metal_history
    from app.services.mcx_service import McxNotConnectedError

    try:
        return await get_metal_history(str(current_user.id), period, contract)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MCX history unavailable: {exc}",
        ) from exc


@router.get("/ai-score")
async def metal_ai_score(
    current_user: CurrentUser,
    direction: TradeSignal = TradeSignal.BUY,
    capital: float = 100_000.0,
    contract: McxMetalsContract = "GOLD",
) -> dict:
    """Metals-AI Pro v1 rule-based confidence score -- see
    app/services/mcx_metals_ai_score_service.py. Same category breakdown as
    NG's score except News Filter (no metals news feed exists)."""
    from app.services.mcx_metals_ai_score_service import compute_metal_ai_score
    from app.services.mcx_service import McxNotConnectedError

    try:
        return await compute_metal_ai_score(
            str(current_user.id), direction.value, capital, contract
        )
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


@router.get("/predict")
async def metal_predict(
    current_user: CurrentUser, period: str = "15m", contract: McxMetalsContract = "GOLD"
) -> dict:
    """Short-horizon local price forecast + rolling accuracy tracker -- see
    app/services/mcx_metals_prediction_service.py."""
    from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
    from app.services.mcx_metals_prediction_service import get_metal_prediction
    from app.services.mcx_service import McxNotConnectedError

    try:
        repo = McxPredictionRepository()
        return await get_metal_prediction(str(current_user.id), contract, period, repo)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MCX prediction unavailable: {exc}",
        ) from exc


@router.get("/predict-archive")
async def metal_predict_archive(
    current_user: CurrentUser, period: str, date: str, contract: McxMetalsContract = "GOLD"
) -> dict:
    """Every prediction made for a past IST calendar date -- powers each
    collapsed day in the accuracy table's archive."""
    from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
    from app.services.mcx_metals_prediction_service import get_metal_archived_day

    try:
        repo = McxPredictionRepository()
        return await get_metal_archived_day(str(current_user.id), contract, period, date, repo)
    except ValueError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get("/dashboard-history")
async def metal_dashboard_history(
    current_user: CurrentUser, contract: McxMetalsContract = "GOLD", days: int = 90
) -> list[dict]:
    """Daily snapshots (LTP/OHLCV/OI + AI buy/sell scores) for the last
    `days` days -- the frontend aggregates these into Day/Week/Month views."""
    from app.infra.db.repositories.mcx_dashboard_snapshot_repo import (
        McxDashboardSnapshotRepository,
    )
    from app.services.mcx_metals_dashboard_snapshot_service import get_metal_snapshot_range

    repo = McxDashboardSnapshotRepository()
    return await get_metal_snapshot_range(str(current_user.id), contract, days, repo)


@router.get("/signals")
async def metal_signals(
    current_user: CurrentUser, contract: McxMetalsContract = "GOLD", limit: int = 50
) -> dict:
    """AI trade signals plus a rolling accuracy readout -- see
    app/services/mcx_metals_signal_service.py."""
    from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
    from app.services.mcx_metals_signal_service import list_metal_signals_with_accuracy

    repo = McxSignalRepository()
    return await list_metal_signals_with_accuracy(str(current_user.id), contract, limit, repo)


@router.get("/news")
async def metal_news(current_user: CurrentUser, limit: int = 20) -> dict:
    """Recent international Base & Precious Metals news (OilPrice.com,
    Investing.com Commodities, filtered to metals relevance), keyword-scored
    for sentiment -- the same feed backing the Metals-AI Pro score's News
    Filter category (see mcx_metals_ai_score_service.py). Reads whatever the
    scheduler's own fetch job already persisted, not a live RSS pull."""
    from app.infra.db.repositories.mcx_metals_news_repo import McxMetalsNewsRepository

    items = await McxMetalsNewsRepository().get_recent(limit=limit)
    avg_sentiment = None
    if items:
        avg_sentiment = round(sum(n["sentiment_score"] for n in items) / len(items), 3)
    return {"articles": items, "avg_sentiment": avg_sentiment}


@router.get("/range-stats")
async def metal_range_stats(
    current_user: CurrentUser, contract: McxMetalsContract = "GOLD"
) -> dict:
    """Day/week/month high-low for the front-month contract -- powers the
    chart's reference lines."""
    from app.services.mcx_metals_service import get_metal_range_stats
    from app.services.mcx_service import McxNotConnectedError

    try:
        return await get_metal_range_stats(str(current_user.id), contract)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MCX range stats unavailable: {exc}",
        ) from exc


@router.get("/trend")
async def metal_trend(current_user: CurrentUser, contract: McxMetalsContract = "GOLD") -> dict:
    """Multi-timeframe trend ladder (1m/5m/15m/1h/1D/1W) with regime-change
    detection -- see app/services/mcx_metals_trend_service.py."""
    from app.services.mcx_metals_trend_service import compute_metal_trend_ladder
    from app.services.mcx_service import McxNotConnectedError

    try:
        return await compute_metal_trend_ladder(str(current_user.id), contract)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Trend ladder unavailable: {exc}",
        ) from exc


class PlaceMetalTradeRequest(BaseModel):
    signal: TradeSignal
    lots: int = Field(ge=1)
    stop_loss: float = Field(gt=0)
    target: float = Field(gt=0)
    limit_price: float | None = Field(default=None, gt=0)
    contract: McxMetalsContract = "GOLD"


@router.post(
    "/trades", status_code=http_status.HTTP_201_CREATED, dependencies=[_trader_or_admin]
)
async def place_metal_trade_route(
    body: PlaceMetalTradeRequest, current_user: CurrentUser, repo: TradeDep
) -> dict:
    from app.services.mcx_metals_service import place_metal_trade
    from app.services.mcx_service import McxNotConnectedError

    try:
        return await place_metal_trade(
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


@router.get("/trades")
async def list_metal_trades_route(
    current_user: CurrentUser,
    repo: TradeDep,
    trade_status: TradeStatus | None = None,
) -> list[dict]:
    from app.services.mcx_metals_service import list_metal_trades

    return await list_metal_trades(str(current_user.id), repo, trade_status)


@router.post("/trades/{trade_id}/close", dependencies=[_trader_or_admin])
async def close_metal_trade_route(
    trade_id: UUID,
    current_user: CurrentUser,
    repo: TradeDep,
    exit_price: float | None = None,
) -> dict:
    from app.services.mcx_metals_service import close_metal_trade
    from app.services.mcx_service import McxNotConnectedError

    try:
        return await close_metal_trade(str(current_user.id), repo, trade_id, exit_price)
    except LookupError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/trades/{trade_id}/cancel", dependencies=[_trader_or_admin])
async def cancel_metal_trade_route(
    trade_id: UUID, current_user: CurrentUser, repo: TradeDep
) -> dict:
    """Cancel a PENDING (unfilled LIMIT) metals order before it triggers."""
    from app.services.mcx_metals_service import cancel_metal_trade

    try:
        return await cancel_metal_trade(str(current_user.id), repo, trade_id)
    except LookupError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
