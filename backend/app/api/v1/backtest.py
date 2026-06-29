from dataclasses import asdict

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.domain.services.backtester import Backtester

router = APIRouter(prefix="/backtest", tags=["backtesting"])

_PERIODS = {"3mo", "6mo", "1y", "2y"}
_STRATEGIES = {"sma_crossover", "rsi_mean_reversion", "macd_crossover"}

_STRATEGY_META = [
    {
        "id": "sma_crossover",
        "name": "SMA 20/50 Crossover",
        "description": (
            "Buy on golden cross (SMA-20 crosses above SMA-50); "
            "sell on death cross. Classic trend-following strategy."
        ),
    },
    {
        "id": "rsi_mean_reversion",
        "name": "RSI Mean-Reversion",
        "description": (
            "Buy when RSI-14 drops below 30 (oversold); "
            "exit when RSI recovers above 65. Counter-trend, short holding period."
        ),
    },
    {
        "id": "macd_crossover",
        "name": "MACD Crossover",
        "description": (
            "Buy when MACD line crosses above signal line (bullish momentum); "
            "exit on the reverse crossover. Momentum-following strategy."
        ),
    },
]


class BacktestRequest(BaseModel):
    symbol: str
    period: str = "6mo"
    strategy: str = "sma_crossover"


@router.get("/strategies")
async def list_strategies(current_user: CurrentUser) -> list[dict]:
    return _STRATEGY_META


@router.post("/run")
async def run_backtest(body: BacktestRequest, current_user: CurrentUser) -> dict:
    if body.period not in _PERIODS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"period must be one of {sorted(_PERIODS)}",
        )
    if body.strategy not in _STRATEGIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"strategy must be one of {sorted(_STRATEGIES)}",
        )
    sym = body.symbol.upper()
    if not (sym.endswith(".NS") or sym.endswith(".BO")):
        sym = f"{sym}.NS"

    bt = Backtester()
    try:
        if body.strategy == "rsi_mean_reversion":
            result = await bt.run_rsi_mean_reversion(sym, body.period)
        elif body.strategy == "macd_crossover":
            result = await bt.run_macd_crossover(sym, body.period)
        else:
            result = await bt.run_sma_crossover(sym, body.period)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return asdict(result)
