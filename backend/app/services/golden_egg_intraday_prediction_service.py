"""1-hour price forecast for the day's Golden Egg pick -- the same EMA20-
slope + ROC-momentum + ATR-cone heuristic as mcx_prediction_service.py
(see that module's docstring for why this isn't literally TimesFM), applied
to NSE cash-equity hourly candles (yfinance) instead of MCX Kite candles.

day/week/month forecasts for the same symbol come from the existing, more
sophisticated ML ensemble (forecast_service.generate_forecast, already
seeded by golden_egg_service.send_golden_egg_email) -- this module only
fills the one horizon that doesn't: within-the-session, hour-by-hour.
forecast_service's shortest horizon is "day" (1 full trading day ahead), not
useful for "will this move in the next couple of hours".

Predictions/accuracy persist via the existing McxPredictionRepository under
a pseudo-user ("golden_egg") with the picked symbol as `contract` and
period "1h" -- the same reuse pattern as mcx_prediction_service's own
get_global_prediction() for Henry Hub: this data isn't tied to anyone's
Zerodha session (yfinance is the same feed for everyone), and the
repository is keyed on plain (user_id, contract, period) strings, so this
can't collide with any real MCX contract's predictions.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
from app.infra.mcx import ng_indicators as ind

IST = timezone(timedelta(hours=5, minutes=30))

GOLDEN_EGG_PREDICTION_USER = "golden_egg"
_PERIOD = "1h"
_BUCKET_SECONDS = 3600
MIN_CANDLES = 20
# Fixed lookahead rather than clipping to NSE's 15:30 close like MCX's
# _buckets_until_market_close -- this chart is also useful to check outside
# market hours (e.g. planning for tomorrow's open), so a few hours ahead of
# the last real candle is shown regardless of where that candle falls.
HORIZON_HOURS = 6


async def _fetch_hourly_candles(symbol: str) -> list[dict]:
    import yfinance as yf

    def _sync() -> list[dict]:
        df = yf.Ticker(symbol).history(period="7d", interval="60m")
        candles = []
        for idx, row in df.iterrows():
            candles.append(
                {
                    "time": int(idx.timestamp()),
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                    "volume": float(row.get("Volume", 0) or 0),
                }
            )
        return candles

    return await asyncio.to_thread(_sync)


def _slope_momentum_atr(candles: list[dict]) -> tuple[float, float, float, float]:
    """(slope-per-bucket, momentum, atr, conviction) -- same formula as
    mcx_prediction_service._slope_momentum_atr, duplicated rather than
    imported since that module's version is private and MCX-flavoured in
    its surrounding context; the math itself is generic price-array math
    (see ng_indicators.py's own docstring on why it's reusable at all)."""
    c = ind.closes(candles)
    h = ind.highs(candles)
    low = ind.lows(candles)
    ema20 = ind.ema_series(c, 20)
    slope = (ema20[-1] - ema20[-5]) / 5 if len(ema20) >= 5 else 0.0
    momentum = ind.roc(c, 10) or 0.0
    atr_val = ind.atr(h, low, c, 14) or (c[-1] * 0.005)
    momentum_sign = 1 if momentum > 0 else (-1 if momentum < 0 else 0)
    slope_sign = 1 if slope > 0 else (-1 if slope < 0 else 0)
    conviction = 1.15 if (slope_sign != 0 and momentum_sign == slope_sign) else 0.65
    return slope, momentum, atr_val, conviction


def _serialize_history(docs: list[dict]) -> list[dict]:
    return [
        {
            "time": d["predicted_time"],
            "predicted_close": d["predicted_close"],
            "upper": d["upper"],
            "lower": d["lower"],
            "actual_close": d.get("actual_close"),
            "hit": d.get("hit"),
        }
        for d in docs
    ]


async def get_1h_prediction(symbol: str, repo: McxPredictionRepository) -> dict:
    candles = await _fetch_hourly_candles(symbol)

    await repo.resolve_pending(GOLDEN_EGG_PREDICTION_USER, symbol, _PERIOD, candles)
    accuracy = await repo.get_accuracy_stats(GOLDEN_EGG_PREDICTION_USER, symbol, _PERIOD)

    if len(candles) < MIN_CANDLES:
        return {
            "symbol": symbol,
            "period": _PERIOD,
            "candles": candles,
            "predicted": [],
            "history": _serialize_history(
                await repo.get_recent(GOLDEN_EGG_PREDICTION_USER, symbol, _PERIOD)
            ),
            "accuracy": accuracy,
            "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, not TimesFM)",
            "note": f"Need at least {MIN_CANDLES} hourly candles for a forecast (have {len(candles)}).",
        }

    last_time = int(candles[-1]["time"])
    last_close = float(candles[-1]["close"])
    slope, _momentum, atr_val, conviction = _slope_momentum_atr(candles)

    predicted = []
    for i in range(1, HORIZON_HOURS + 1):
        t = last_time + i * _BUCKET_SECONDS
        proj_close = last_close + slope * i * conviction
        band = atr_val * (i**0.5)
        predicted.append(
            {
                "time": t,
                "predicted_close": round(proj_close, 2),
                "upper": round(proj_close + band, 2),
                "lower": round(proj_close - band, 2),
            }
        )

    await repo.save_predictions(GOLDEN_EGG_PREDICTION_USER, symbol, _PERIOD, predicted)
    history = _serialize_history(
        await repo.get_recent(GOLDEN_EGG_PREDICTION_USER, symbol, _PERIOD, limit=200)
    )

    return {
        "symbol": symbol,
        "period": _PERIOD,
        "candles": candles,
        "generated_at": datetime.utcnow().isoformat(),
        "last_actual_time": last_time,
        "last_actual_close": round(last_close, 2),
        "predicted": predicted,
        "history": history,
        "accuracy": accuracy,
        "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, not TimesFM)",
    }
