from dataclasses import asdict

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.domain.services.backtester import Backtester

router = APIRouter(prefix="/backtest", tags=["backtesting"])

_PERIODS = {"3mo", "6mo", "1y"}


class BacktestRequest(BaseModel):
    symbol: str
    period: str = "6mo"


@router.get("/strategies")
async def list_strategies(current_user: CurrentUser) -> list[dict]:
    return [
        {
            "id": "sma_crossover",
            "name": "SMA 20/50 Crossover",
            "description": (
                "Buy on golden cross (SMA-20 crosses above SMA-50); "
                "sell on death cross. Classic trend-following strategy."
            ),
        }
    ]


@router.post("/run")
async def run_backtest(body: BacktestRequest, current_user: CurrentUser) -> dict:
    if body.period not in _PERIODS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"period must be one of {sorted(_PERIODS)}",
        )
    sym = body.symbol.upper()
    if not (sym.endswith(".NS") or sym.endswith(".BO")):
        sym = f"{sym}.NS"
    try:
        result = await Backtester().run_sma_crossover(sym, body.period)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    d = asdict(result)
    return d
