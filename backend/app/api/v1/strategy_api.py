"""Strategy Builder API — CRUD for rules-based strategies + on-demand backtest."""

from __future__ import annotations

import asyncio
from dataclasses import asdict
from uuid import uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.domain.models.strategy import INDICATORS, OPERATORS, Strategy, StrategyCondition
from app.infra.db.repositories.strategy_repo import StrategyRepository

router = APIRouter(prefix="/strategy", tags=["strategy-builder"])


class ConditionBody(BaseModel):
    indicator: str
    operator: str
    value: float


class StrategyBody(BaseModel):
    name: str
    action: str  # BUY | SELL
    conditions: list[ConditionBody]
    description: str = ""


def _serialize(s: Strategy) -> dict:
    d = asdict(s)
    d["id"] = str(d["id"])
    d["created_at"] = s.created_at.isoformat()
    return d


@router.get("/meta")
async def get_meta() -> dict:
    """Return available indicators and operators for the frontend builder."""
    return {"indicators": INDICATORS, "operators": OPERATORS}


@router.get("")
async def list_strategies(current_user: CurrentUser) -> list[dict]:
    repo = StrategyRepository()
    strategies = await repo.list_by_user(str(current_user.id))
    return [_serialize(s) for s in strategies]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_strategy(body: StrategyBody, current_user: CurrentUser) -> dict:
    if body.action.upper() not in ("BUY", "SELL"):
        raise HTTPException(400, detail="action must be BUY or SELL")
    for c in body.conditions:
        if c.indicator not in INDICATORS:
            raise HTTPException(400, detail=f"Unknown indicator: {c.indicator}")
        if c.operator not in OPERATORS:
            raise HTTPException(400, detail=f"Unknown operator: {c.operator}")

    strategy = Strategy(
        id=uuid4(),
        name=body.name.strip(),
        user_id=str(current_user.id),
        action=body.action.upper(),
        description=body.description,
        conditions=[StrategyCondition(c.indicator, c.operator, c.value) for c in body.conditions],
    )
    repo = StrategyRepository()
    await repo.save(strategy)
    return _serialize(strategy)


@router.get("/{strategy_id}")
async def get_strategy(strategy_id: str, current_user: CurrentUser) -> dict:
    repo = StrategyRepository()
    s = await repo.get(strategy_id)
    if not s or s.user_id != str(current_user.id):
        raise HTTPException(404, detail="Strategy not found")
    return _serialize(s)


@router.delete("/{strategy_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_strategy(strategy_id: str, current_user: CurrentUser) -> None:
    repo = StrategyRepository()
    deleted = await repo.delete(strategy_id, str(current_user.id))
    if not deleted:
        raise HTTPException(404, detail="Strategy not found")


@router.patch("/{strategy_id}/toggle")
async def toggle_strategy(strategy_id: str, current_user: CurrentUser) -> dict:
    repo = StrategyRepository()
    s = await repo.get(strategy_id)
    if not s or s.user_id != str(current_user.id):
        raise HTTPException(404, detail="Strategy not found")
    await repo.set_active(strategy_id, str(current_user.id), not s.is_active)
    s.is_active = not s.is_active
    return _serialize(s)


class BacktestStrategyRequest(BaseModel):
    symbol: str
    period: str = "1y"  # 1y | 2y | 3y


@router.post("/{strategy_id}/backtest")
async def backtest_strategy(
    strategy_id: str,
    body: BacktestStrategyRequest,
    current_user: CurrentUser,
) -> dict:
    repo = StrategyRepository()
    s = await repo.get(strategy_id)
    if not s or s.user_id != str(current_user.id):
        raise HTTPException(404, detail="Strategy not found")

    sym = body.symbol.upper()
    if not sym.endswith((".NS", ".BO")):
        sym += ".NS"

    try:
        result = await _run_strategy_backtest(s, sym, body.period)
        return result
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, detail=f"Backtest failed: {exc}") from exc


# ── Strategy backtest engine ──────────────────────────────────────────────────


def _evaluate_condition(cond: StrategyCondition, row: dict, prev_row: dict | None) -> bool:
    val = row.get(cond.indicator)
    if val is None:
        return False
    threshold = cond.value

    if cond.operator == "<":
        return float(val) < threshold
    if cond.operator == ">":
        return float(val) > threshold
    if cond.operator == "<=":
        return float(val) <= threshold
    if cond.operator == ">=":
        return float(val) >= threshold
    if cond.operator == "==":
        return abs(float(val) - threshold) < 0.01
    if cond.operator in ("crosses_above", "crosses_below") and prev_row:
        prev_val = prev_row.get(cond.indicator)
        if prev_val is None:
            return False
        if cond.operator == "crosses_above":
            return float(prev_val) < threshold <= float(val)
        return float(prev_val) > threshold >= float(val)
    return False


def _run_sync(strategy: Strategy, symbol: str, period: str) -> dict:
    import numpy as np
    import pandas as pd
    import yfinance as yf

    ticker = yf.Ticker(symbol)
    df = ticker.history(period=period)
    if df.empty or len(df) < 60:
        raise ValueError(f"Insufficient history for {symbol}")

    c = df["Close"]
    v = df["Volume"]

    # Compute all indicators
    delta = c.diff()
    gain = delta.clip(lower=0).ewm(com=13, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(com=13, adjust=False).mean()
    df["rsi"] = 100 - (100 / (1 + gain / loss.replace(0, np.nan)))

    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    df["macd"] = macd
    df["macd_hist"] = macd - macd.ewm(span=9, adjust=False).mean()

    sma20 = c.rolling(20).mean()
    sma50 = c.rolling(50).mean()
    df["sma20_ratio"] = (c / sma20 - 1).fillna(0)
    df["sma50_ratio"] = (c / sma50 - 1).fillna(0)

    std20 = c.rolling(20).std()
    bb_upper = sma20 + 2 * std20
    bb_lower = sma20 - 2 * std20
    df["bb_position"] = ((c - bb_lower) / (bb_upper - bb_lower + 1e-9)).fillna(0.5)

    tr = pd.concat(
        [df["High"] - df["Low"], (df["High"] - c.shift()).abs(), (df["Low"] - c.shift()).abs()],
        axis=1,
    ).max(axis=1)
    df["atr_pct"] = (tr.rolling(14).mean() / c).fillna(0)
    df["vol_ratio"] = (v / v.rolling(20).mean()).fillna(1)
    df["price"] = c
    df["volume"] = v

    records = df.to_dict("records")
    dates = df.index.tolist()

    trades = []
    in_trade = False
    entry_price = 0.0
    entry_date = None

    for i, (row, dt) in enumerate(zip(records, dates, strict=True)):
        prev_row = records[i - 1] if i > 0 else None
        signal_met = all(_evaluate_condition(cond, row, prev_row) for cond in strategy.conditions)

        price = float(row["price"])
        if not in_trade and signal_met:
            if strategy.action == "BUY":
                in_trade = True
                entry_price = price
                entry_date = dt
        elif in_trade:
            # Exit on opposite signal or end of data
            opposite_met = not signal_met
            if opposite_met or i == len(records) - 1:
                pnl = price - entry_price if strategy.action == "BUY" else entry_price - price
                pnl_pct = pnl / entry_price * 100 if entry_price else 0.0
                trades.append(
                    {
                        "date_in": str(entry_date)[:10],
                        "date_out": str(dt)[:10],
                        "signal": strategy.action,
                        "entry": round(entry_price, 2),
                        "exit": round(price, 2),
                        "pnl": round(pnl, 2),
                        "pnl_pct": round(pnl_pct, 2),
                    }
                )
                in_trade = False

    # Equity curve
    capital = 100_000.0
    equity: list[dict] = [{"date": str(dates[0])[:10], "value": capital}]
    for t in trades:
        capital *= 1 + t["pnl_pct"] / 100
        equity.append({"date": t["date_out"], "value": round(capital, 2)})

    winners = [t for t in trades if t["pnl"] > 0]
    losers = [t for t in trades if t["pnl"] <= 0]
    total_return = (capital - 100_000) / 100_000 * 100

    returns = np.array([t["pnl_pct"] / 100 for t in trades])
    sharpe = (
        float(np.mean(returns) / (np.std(returns) + 1e-9) * np.sqrt(252))
        if len(returns) > 1
        else 0.0
    )

    # Max drawdown on equity curve
    eq_vals = np.array([e["value"] for e in equity])
    peak = np.maximum.accumulate(eq_vals)
    drawdown = (peak - eq_vals) / (peak + 1e-9) * 100
    max_dd = float(np.max(drawdown)) if len(drawdown) > 0 else 0.0

    return {
        "symbol": symbol,
        "strategy_name": strategy.name,
        "action": strategy.action,
        "period": period,
        "total_trades": len(trades),
        "winners": len(winners),
        "losers": len(losers),
        "win_rate_pct": round(len(winners) / len(trades) * 100, 1) if trades else 0.0,
        "total_return_pct": round(total_return, 2),
        "max_drawdown_pct": round(max_dd, 2),
        "sharpe_ratio": round(sharpe, 2),
        "trades": trades[-50:],  # last 50 for response size
        "equity_curve": equity,
    }


async def _run_strategy_backtest(strategy: Strategy, symbol: str, period: str) -> dict:
    loop = asyncio.get_event_loop()
    from functools import partial

    return await loop.run_in_executor(None, partial(_run_sync, strategy, symbol, period))
