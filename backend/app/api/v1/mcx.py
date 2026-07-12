"""MCX Natural Gas / Natural Gas Mini — live quote (via connected Zerodha
Kite account) and paper trading (reuses the same Trade domain model as
equity paper trading). Routes stay under /mcx/ng/* for backward compat;
a `contract` query param selects which instrument -- "NG" (front month) or
"NGMINI", or a specific NG expiry month ("NG_AUG", "NG_SEP", "NG_OCT",
"NG_NOV", "NG_DEC")."""

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

McxContract = Literal["NG", "NGMINI", "NG_AUG", "NG_SEP", "NG_OCT", "NG_NOV", "NG_DEC"]


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


@router.get("/ng/predict-archive")
async def ng_predict_archive(
    current_user: CurrentUser, period: str, date: str, contract: McxContract = "NG"
) -> dict:
    """Every prediction made for a past IST calendar date ("YYYY-MM-DD") --
    powers each collapsed day in the accuracy table's archive. Predictions
    are never deleted, so this is just a date-range query, not a separate
    snapshot (see mcx_prediction_service.get_archived_day)."""
    from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
    from app.services.mcx_prediction_service import get_archived_day

    try:
        repo = McxPredictionRepository()
        return await get_archived_day(str(current_user.id), contract, period, date, repo)
    except ValueError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get("/ng/dashboard-history")
async def ng_dashboard_history(
    current_user: CurrentUser, contract: McxContract = "NG", days: int = 90
) -> list[dict]:
    """Daily NG Dashboard snapshots (LTP/OHLCV/OI + AI buy/sell scores) for
    the last `days` days -- the frontend aggregates these into Day/Week/
    Month views (see mcx_dashboard_snapshot_service.py)."""
    from app.infra.db.repositories.mcx_dashboard_snapshot_repo import (
        McxDashboardSnapshotRepository,
    )
    from app.services.mcx_dashboard_snapshot_service import get_snapshot_range

    repo = McxDashboardSnapshotRepository()
    return await get_snapshot_range(str(current_user.id), contract, days, repo)


@router.get("/ng/global-symbols-history")
async def ng_global_symbols_history(current_user: CurrentUser, days: int = 90) -> list[dict]:
    """Daily snapshots of every Global Natural Gas Symbols row (NG, NGMINI,
    Henry Hub, Dutch TTF) for the last `days` days -- the frontend groups by
    each row's `key` and aggregates into Day/Week/Month views, same pattern
    as ng_dashboard_history above (see
    mcx_global_symbols_snapshot_service.py)."""
    from app.infra.db.repositories.mcx_global_symbols_snapshot_repo import (
        McxGlobalSymbolsSnapshotRepository,
    )
    from app.services.mcx_global_symbols_snapshot_service import get_global_symbols_snapshot_range

    repo = McxGlobalSymbolsSnapshotRepository()
    return await get_global_symbols_snapshot_range(str(current_user.id), days, repo)


@router.get("/ng/global-symbols")
async def ng_global_symbols(current_user: CurrentUser) -> list[dict]:
    """MCX Natural Gas / Natural Gas Mini (real, via Kite) alongside Henry
    Hub (NYMEX) and Dutch TTF (ICE) via yfinance -- see
    mcx_global_symbols_service.py for which international benchmarks were
    left out (no usable Yahoo Finance data) and why."""
    from app.services.mcx_global_symbols_service import get_global_symbols

    return await get_global_symbols(str(current_user.id))


@router.get("/ng/news")
async def ng_news(current_user: CurrentUser, limit: int = 20) -> dict:
    """Recent international NG/energy news (OilPrice.com, Investing.com
    Commodities, Natural Gas Intel), keyword-filtered to NG relevance and
    keyword-scored for sentiment -- the same feed backing the NG-AI Pro
    score's News Filter category (see mcx_ai_score_service.py). Reads
    whatever the scheduler's own fetch job already persisted, not a live
    RSS pull, so this is fast regardless of feed latency."""
    from app.infra.db.repositories.mcx_news_repo import McxNewsRepository

    items = await McxNewsRepository().get_recent(limit=limit)
    avg_sentiment = None
    if items:
        avg_sentiment = round(sum(n["sentiment_score"] for n in items) / len(items), 3)
    return {"articles": items, "avg_sentiment": avg_sentiment}


@router.get("/ng/signals")
async def ng_signals(
    current_user: CurrentUser, contract: McxContract = "NG", limit: int = 50
) -> dict:
    """AI trade signals (logged whenever the score hits verdict=TRADE) plus
    a rolling accuracy readout -- see app/services/mcx_signal_service.py."""
    from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
    from app.services.mcx_signal_service import list_signals_with_accuracy

    repo = McxSignalRepository()
    return await list_signals_with_accuracy(str(current_user.id), contract, limit, repo)


@router.get("/my-dashboard")
async def my_trading_dashboard(current_user: CurrentUser, limit: int = 10) -> dict:
    """AI-Strength-ranked view across every tracked MCX contract (NG +
    Metals combined) -- see app/services/mcx_my_dashboard_service.py. AI
    score/verdict come from a 5-min-refreshed cache, not computed live, so
    this is fast enough to poll."""
    from app.services.mcx_my_dashboard_service import get_ranked_dashboard

    return await get_ranked_dashboard(str(current_user.id), limit)


@router.get("/backtest", dependencies=[Depends(require_role(UserRole.ADMIN))])
async def mcx_backtest(current_user: CurrentUser) -> dict:
    """AI signal-scorer backtest across trailing 1m/3m/6m/12m/1y/3y/5y
    windows, split into NG vs Metals -- evaluates the rule-based scorer's
    own logged outcomes (see app/services/mcx_backtest_service.py) across
    every user's signals, not just the caller's. Admin-only since it's a
    model-evaluation report, not personal trading data."""
    from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
    from app.services.mcx_backtest_service import get_backtest_report

    repo = McxSignalRepository()
    return await get_backtest_report(repo)


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


@router.post("/ng/trades/{trade_id}/cancel", dependencies=[_trader_or_admin])
async def cancel_ng_trade(trade_id: UUID, current_user: CurrentUser, repo: TradeDep) -> dict:
    """Cancel a PENDING (unfilled LIMIT) MCX order before it triggers."""
    from app.services.mcx_service import cancel_ng_trade

    try:
        return await cancel_ng_trade(str(current_user.id), repo, trade_id)
    except LookupError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
