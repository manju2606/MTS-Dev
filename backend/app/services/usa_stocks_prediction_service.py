"""USA Stocks price prediction: the same local heuristic MCX/Crypto use
(EMA20 slope + ROC momentum + ATR cone, not a trained model), reusing
mcx_prediction_service._slope_momentum_atr directly since it only needs a
plain candle list.

Same simplification as crypto_prediction_service.py: a fixed
PREDICT_HORIZON buckets ahead from the last real candle, no session-close
cutoff. Unlike Crypto, US markets genuinely do close (NYSE/NASDAQ regular
hours, roughly 19:00-01:30 IST depending on DST) -- this doesn't model
that yet, so some predicted buckets can land after-hours/on a weekend
where no real candle will ever resolve them. Same tradeoff MCX's own
session-aware bucketing exists specifically to avoid, just not carried
over here -- flagged rather than silently done, since building real
NYSE-session-aware bucketing (like mcx_prediction_service's
_snap_to_session_grid/_buckets_until_market_close) is a separate, larger
piece of work than this page's initial scope.

No Mongo persistence/accuracy-tracking layer (unlike MCX) -- computed
fresh per request from usa_stocks_service.get_klines's cached candles.
"""

from __future__ import annotations

import asyncio
from datetime import datetime

from app.services.mcx_prediction_service import _slope_momentum_atr
from app.services.usa_stocks_service import PERIODS as USA_STOCK_PERIODS
from app.services.usa_stocks_service import get_klines, get_quotes, get_tracked_codes

PREDICT_HORIZON = 10
MIN_CANDLES = 20

# The 3 timeframes shown in the Ranked USA Stocks Prediction table --
# matches crypto_prediction_service.RANKED_PERIODS exactly.
RANKED_PERIODS: tuple[str, ...] = ("15m", "1h", "1D")


async def get_prediction(code: str, period: str = "30m") -> dict:
    candles = await get_klines(code, period)
    bucket = USA_STOCK_PERIODS[period][2]

    if len(candles) < MIN_CANDLES:
        return {
            "code": code.upper(),
            "period": period,
            "predicted": [],
            "note": f"Need at least {MIN_CANDLES} candles for a forecast (have {len(candles)}).",
            "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, "
            "not a trained model)",
        }

    last_time = int(candles[-1]["time"])
    last_close = float(candles[-1]["close"])
    slope, _momentum, atr_val, conviction = _slope_momentum_atr(candles)

    predicted = []
    for i in range(1, PREDICT_HORIZON + 1):
        proj_close = last_close + slope * i * conviction
        band = atr_val * (i**0.5)
        predicted.append(
            {
                "time": last_time + i * bucket,
                "predicted_close": round(proj_close, 2),
                "upper": round(proj_close + band, 2),
                "lower": round(proj_close - band, 2),
            }
        )

    return {
        "code": code.upper(),
        "period": period,
        "generated_at": datetime.utcnow().isoformat(),
        "last_actual_time": last_time,
        "last_actual_close": last_close,
        "predicted": predicted,
        "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, not a trained model)",
    }


async def _nearest_predicted(code: str, period: str) -> float | None:
    try:
        pred = await get_prediction(code, period)
        predicted = pred.get("predicted") or []
        return predicted[0]["predicted_close"] if predicted else None
    except Exception:
        return None


async def get_ranked_predictions() -> dict:
    """Every tracked stock's LTP/24H-equivalent change plus its nearest
    predicted price at each RANKED_PERIODS timeframe, ranked by change
    descending -- same "heat map" ordering as Crypto's, no AI score to
    rank by here either."""
    quotes = await get_quotes()
    quotes_by_code = {q["code"]: q for q in quotes}

    async def _row(code: str) -> dict:
        preds = await asyncio.gather(*[_nearest_predicted(code, p) for p in RANKED_PERIODS])
        quote = quotes_by_code.get(code)
        return {
            "code": code,
            "price": quote["price"] if quote else None,
            "change_pct": quote.get("change_pct") if quote else None,
            "predicted": dict(zip(RANKED_PERIODS, preds, strict=True)),
        }

    codes = await get_tracked_codes()
    rows = await asyncio.gather(*[_row(code) for code in codes])

    def _sort_key(row: dict) -> float:
        pct = row["change_pct"]
        return pct if pct is not None else float("-inf")

    rows.sort(key=_sort_key, reverse=True)
    return {"generated_at": datetime.utcnow().isoformat(), "ranked": rows}
