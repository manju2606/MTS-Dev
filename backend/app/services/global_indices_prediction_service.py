"""Global Indices AI Prediction: same local heuristic MCX/Crypto/USA
Stocks use (EMA20 slope + ROC momentum + ATR cone), reusing
mcx_prediction_service._slope_momentum_atr directly.

Unlike those pages, International Market has no per-index candlestick
chart (it's a heat-map/table dashboard, not a chart page), so predictions
are shown as a compact "predicted price at each timeframe" panel for
whichever index is selected, rather than a time-series overlay on a
chart -- see get_all_predictions().

4h/8h have no native yfinance interval (same gap documented in
usa_stocks_service.py) and, per research into MCX's own "4h/6h/8h"
periods, MCX doesn't do real OHLC resampling for those either -- it
reuses the same 60-minute candles and just spaces the *predicted* points
4/6/8 hours apart, not the historical candles themselves. This module
does the same: 4h/8h predictions extrapolate the 1h slope forward by 4 or
8 steps instead of fetching/resampling synthetic 4h/8h candles.

No Mongo persistence/accuracy-tracking layer (unlike MCX) -- computed
fresh per request from global_indices_service.get_klines's cached
candles.
"""

from __future__ import annotations

import asyncio
from datetime import datetime

from app.services.global_indices_service import get_klines
from app.services.mcx_prediction_service import _slope_momentum_atr

MIN_CANDLES = 20

METHOD = "ema20-slope + roc-momentum + atr-cone (local heuristic, not a trained model)"

# Display period -> (source period fetched via get_klines, steps-ahead
# multiplier applied to that source's own slope-per-bucket). For most
# periods the source matches the label 1:1 (1 native bucket ahead); 4h/8h
# both reuse "1h" candles, projected 4 or 8 hourly-steps ahead instead.
PREDICTION_PERIODS: dict[str, tuple[str, int]] = {
    "5m": ("5m", 1),
    "15m": ("15m", 1),
    "30m": ("30m", 1),
    "1h": ("1h", 1),
    "4h": ("1h", 4),
    "8h": ("1h", 8),
    "1D": ("1D", 1),
    "1W": ("1W", 1),
    "1M": ("1M", 1),
}


async def _predict_one(code: str, period: str) -> dict | None:
    source_period, steps_ahead = PREDICTION_PERIODS[period]
    candles = await get_klines(code, source_period)
    if len(candles) < MIN_CANDLES:
        return None

    last_close = float(candles[-1]["close"])
    slope, _momentum, atr_val, conviction = _slope_momentum_atr(candles)
    proj_close = last_close + slope * steps_ahead * conviction
    band = atr_val * (steps_ahead**0.5)
    pct_change = round((proj_close - last_close) / last_close * 100, 4) if last_close else 0.0

    return {
        "predicted_close": round(proj_close, 2),
        "upper": round(proj_close + band, 2),
        "lower": round(proj_close - band, 2),
        "pct_change": pct_change,
    }


async def get_all_predictions(code: str) -> dict:
    periods = list(PREDICTION_PERIODS.keys())

    async def _safe_predict(period: str) -> dict | None:
        try:
            return await _predict_one(code, period)
        except Exception:
            return None

    results = await asyncio.gather(*[_safe_predict(p) for p in periods])
    return {
        "code": code.upper(),
        "generated_at": datetime.utcnow().isoformat(),
        "method": METHOD,
        "predicted": dict(zip(periods, results, strict=True)),
    }
