"""MTS Gold Strategy -- a dedicated multi-timeframe (1H/15M/5M) intraday
scorer for MCX Gold, GoldMini, GoldTen, GoldGuinea, and GoldPetal. Sibling
router to mcx_silver_strategy.py -- see app/services/mcx_gold_strategy_service.py."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi import status as http_status

from app.api.deps import CurrentUser
from app.domain.models.trade import TradeSignal

router = APIRouter(prefix="/mcx/gold-strategy", tags=["mcx"])

GoldStrategyContract = Literal["GOLD", "GOLDMINI", "GOLDTEN", "GOLDGUINEA", "GOLDPETAL"]


@router.get("/score")
async def gold_strategy_score(
    current_user: CurrentUser,
    direction: TradeSignal = TradeSignal.BUY,
    contract: GoldStrategyContract = "GOLD",
    capital: float = 100_000.0,
    account_risk_pct: float = 0.5,
) -> dict:
    """MTS Gold Strategy score -- see compute_gold_strategy_score's own
    docstring for the full category breakdown."""
    from app.services.mcx_gold_strategy_service import compute_gold_strategy_score
    from app.services.mcx_service import McxNotConnectedError

    try:
        return await compute_gold_strategy_score(
            str(current_user.id), direction.value, contract, capital, account_risk_pct
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
            detail=f"MTS Gold Strategy score unavailable: {exc}",
        ) from exc


@router.get("/signals")
async def gold_strategy_signals(
    current_user: CurrentUser, contract: GoldStrategyContract = "GOLD", limit: int = 50
) -> dict:
    """Logged MTS Gold Strategy signals plus a rolling accuracy readout --
    separate from Metals-AI Pro's own /mcx/metals/signals for the same
    underlying contract (see mcx_gold_strategy_service.py's synthetic
    signal-key convention)."""
    from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
    from app.services.mcx_gold_strategy_service import list_gold_signals_with_accuracy

    repo = McxSignalRepository()
    return await list_gold_signals_with_accuracy(str(current_user.id), contract, limit, repo)


@router.get("/risk-status")
async def gold_strategy_risk_status(
    current_user: CurrentUser, contract: GoldStrategyContract = "GOLD"
) -> dict:
    """Today's trade count / realized P&L / consecutive-loss streak against
    the configured daily limits, plus session-window and expiry-protection
    reads -- the same hard gate the scheduler job enforces before logging a
    new signal (see can_generate_new_signal), exposed read-only for the
    frontend's risk panel."""
    from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
    from app.services.mcx_gold_strategy_service import get_gold_risk_status
    from app.services.mcx_service import McxNotConnectedError

    try:
        repo = McxSignalRepository()
        return await get_gold_risk_status(str(current_user.id), contract, repo)
    except McxNotConnectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Risk status unavailable: {exc}",
        ) from exc


@router.get("/backtest")
async def gold_strategy_backtest(
    current_user: CurrentUser,
    contract: GoldStrategyContract = "GOLD",
    capital: float = 100_000.0,
) -> dict:
    """Backtests this user's own real logged MTS Gold Strategy signals --
    see run_gold_strategy_backtest's docstring for why this isn't a
    historical-candle re-simulation."""
    from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository
    from app.services.mcx_gold_strategy_service import run_gold_strategy_backtest

    repo = McxSignalRepository()
    return await run_gold_strategy_backtest(str(current_user.id), contract, repo, capital)
