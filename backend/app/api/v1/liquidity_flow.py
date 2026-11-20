"""Liquidity Flow API: Smart Money Concepts analytics, backtesting, multi-timeframe
confirmation, market scanner and order-flow views.

Read-only analytics. Nothing here places orders.
"""

from __future__ import annotations

import re
from dataclasses import asdict
from typing import Literal

import structlog
from fastapi import APIRouter, HTTPException, Query

from app.api.deps import CurrentUser
from app.domain.services.liquidity_flow.backtest import (
    BacktestConfig,
    compute_metrics,
    monte_carlo,
    run_backtest,
    walk_forward,
)
from app.domain.services.liquidity_flow.engine import Candle, LiquidityAnalysis, analyze
from app.domain.services.liquidity_flow.multi_timeframe import mtf_confirmation
from app.domain.services.liquidity_flow.order_flow import estimated_cvd, volume_profile
from app.infra.market_data.liquidity_candles import fetch_candles
from app.services.liquidity_scanner import UNIVERSES, scan

log = structlog.get_logger()

router = APIRouter(prefix="/liquidity-flow", tags=["liquidity-flow"])

_SYMBOL_RE = re.compile(r"^[A-Z0-9&\-]{1,20}(\.(NS|BO))?$")
_HOLDING = {"1d": "1–5 sessions", "1h": "1–3 sessions"}
_CHART_BARS = 250
_DISCLAIMER = (
    "Analytics for research only. Not investment advice and not an order instruction. "
    "The latest bar may still be forming during market hours."
)


def _normalise_symbol(raw: str) -> str:
    s = raw.strip().upper()
    if not _SYMBOL_RE.match(s):
        raise HTTPException(status_code=422, detail="Invalid symbol")
    return s if s.endswith((".NS", ".BO")) else f"{s}.NS"


async def _candles_or_502(sym: str, interval: str) -> list[Candle]:
    try:
        candles = await fetch_candles(sym, interval)
    except Exception as exc:
        log.warning("liquidity_flow.fetch_failed", symbol=sym, error=str(exc))
        raise HTTPException(status_code=502, detail=f"Market data unavailable for {sym}") from exc
    if not candles:
        raise HTTPException(status_code=404, detail=f"No price data found for {sym}")
    return candles


def _run_analyze(candles: list[Candle], interval: str) -> LiquidityAnalysis:
    try:
        return analyze(candles, holding_period=_HOLDING[interval])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/analyze")
async def analyze_symbol(
    current_user: CurrentUser,
    symbol: str = Query(..., max_length=32),
    interval: Literal["1d", "1h"] = "1d",
) -> dict[str, object]:
    sym = _normalise_symbol(symbol)
    candles = await _candles_or_502(sym, interval)
    result = _run_analyze(candles, interval)

    payload = asdict(result)
    payload["symbol"] = sym
    payload["interval"] = interval
    payload["candles"] = [
        {
            "time": c.time,
            "open": c.open,
            "high": c.high,
            "low": c.low,
            "close": c.close,
            "volume": c.volume,
        }
        for c in candles[-_CHART_BARS:]
    ]
    payload["disclaimer"] = _DISCLAIMER
    return payload


@router.get("/mtf")
async def multi_timeframe(
    current_user: CurrentUser,
    symbol: str = Query(..., max_length=32),
) -> dict[str, object]:
    """Daily sets the bias, hourly must confirm it."""
    sym = _normalise_symbol(symbol)
    daily = _run_analyze(await _candles_or_502(sym, "1d"), "1d")
    hourly = _run_analyze(await _candles_or_502(sym, "1h"), "1h")
    conf = mtf_confirmation(daily, hourly)
    return {
        "symbol": sym,
        "confirmation": asdict(conf),
        "daily": {
            "signal": daily.recommendation["signal"],
            "confidence": daily.recommendation["confidence"],
            "trend": daily.trend,
            "recommendation": daily.recommendation,
        },
        "hourly": {
            "signal": hourly.recommendation["signal"],
            "confidence": hourly.recommendation["confidence"],
            "trend": hourly.trend,
            "recommendation": hourly.recommendation,
        },
        "disclaimer": _DISCLAIMER,
    }


@router.get("/backtest")
async def backtest_symbol(
    current_user: CurrentUser,
    symbol: str = Query(..., max_length=32),
    interval: Literal["1d", "1h"] = "1d",
    max_hold: int = Query(10, ge=1, le=60),
    folds: int = Query(3, ge=2, le=6),
    slippage_pct: float = Query(0.05, ge=0, le=1),
) -> dict[str, object]:
    sym = _normalise_symbol(symbol)
    candles = await _candles_or_502(sym, interval)
    cfg = BacktestConfig(max_hold_bars=max_hold, slippage_pct=slippage_pct)
    try:
        trades = run_backtest(candles, cfg)
        wf = walk_forward(candles, folds=folds, cfg=cfg)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    r_list = [t.r_multiple for t in trades]
    return {
        "symbol": sym,
        "interval": interval,
        "bars": len(candles),
        "config": {
            "max_hold_bars": max_hold,
            "slippage_pct": slippage_pct,
            "warmup": cfg.warmup,
            "entry": "next bar open",
            "ambiguous_bar": "stop first",
        },
        "metrics": compute_metrics(trades),
        "walk_forward": wf,
        "monte_carlo": monte_carlo(r_list),
        "trades": [asdict(t) for t in trades[-100:]],
        "disclaimer": _DISCLAIMER,
    }


@router.get("/scan")
async def market_scan(
    current_user: CurrentUser,
    universe: Literal["nifty50", "nifty100", "nifty200"] = "nifty50",
    side: Literal["bullish", "bearish", "all"] = "all",
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, object]:
    if universe not in UNIVERSES:
        raise HTTPException(status_code=422, detail="Unknown universe")
    result = await scan(universe, side=side, limit=limit)
    result["disclaimer"] = _DISCLAIMER
    return result


@router.get("/order-flow")
async def order_flow(
    current_user: CurrentUser,
    symbol: str = Query(..., max_length=32),
    interval: Literal["1d", "1h"] = "1d",
) -> dict[str, object]:
    sym = _normalise_symbol(symbol)
    candles = await _candles_or_502(sym, interval)
    vp = volume_profile(candles[-120:])
    cvd = estimated_cvd(candles)[-_CHART_BARS:]
    unavailable = {
        "available": False,
        "reason": "Needs a live tick or order-book feed. None is connected to this deployment, "
        "so no values are shown rather than estimated numbers.",
    }
    return {
        "symbol": sym,
        "interval": interval,
        "volume_profile": {
            "source": "ohlc_estimate",
            "note": "Volume is spread across each bar's range. "
            "Approximate, not traded-at-price data.",
            "poc": vp.poc,
            "value_area_high": vp.value_area_high,
            "value_area_low": vp.value_area_low,
            "total_volume": vp.total_volume,
            "buckets": [asdict(b) for b in vp.buckets],
        },
        "cvd": {
            "source": "ohlc_estimate",
            "note": "Estimated from where each close sits in its range, not true buy/sell volume.",
            "series": cvd,
        },
        "footprint": {"source": "tick_feed", **unavailable},
        "bid_ask_imbalance": {"source": "depth_feed", **unavailable},
        "open_interest": {
            "source": "options_chain",
            "available": False,
            "reason": "Open-interest analysis is only defined for F&O underlyings and is not wired "
            "to this module yet. The existing /options endpoint has the chain data.",
        },
        "disclaimer": _DISCLAIMER,
    }


@router.get("/alerts")
async def liquidity_alerts(
    current_user: CurrentUser,
    universe: Literal["nifty50", "nifty100", "nifty200"] = "nifty50",
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, object]:
    """Stocks with a structure break or sweep in the last two closed daily bars.
    This is a pull-based feed. There are no push notifications."""
    result = await scan(universe, side="all", limit=limit, fresh_only=True)
    result["disclaimer"] = _DISCLAIMER
    return result
