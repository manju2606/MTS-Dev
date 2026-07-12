"""Crypto price prediction: the same local heuristic MCX uses (EMA20 slope
+ ROC momentum + ATR cone, not a trained model -- see
mcx_prediction_service.py's own docstring for why), reusing that module's
pure-math _slope_momentum_atr() directly since it only needs a plain candle
list, nothing Kite-specific.

Adapted for a 24/7 market: MCX bounds predictions to "buckets remaining
before session close" (09:00-23:45 IST) since MCX actually stops trading
at night. Crypto never closes, so there's no such cutoff -- this instead
predicts a fixed PREDICT_HORIZON buckets ahead from the last real candle,
rolling forward continuously.

Candle data comes from Binance (binance_service.get_klines), not
CoinGecko -- CoinGecko's free OHLC endpoint tops out at 30-min granularity
with no native 1m/5m/15m/1D/1W/1M candles. Quotes (LTP/24h change, ₹ and
$) still come from crypto_service's CoinGecko quotes; only the candle
source changed.

No Mongo persistence/accuracy-tracking layer (unlike MCX's
mcx_prediction_repo.py) -- the local EMA-slope math itself is computed
fresh per request, which is cheap. What *is* cached is the underlying
Binance klines (binance_service._cache_ttl, up to 5 min for coarse
periods), proactively kept warm for the ranked table's periods by the
scheduler's crypto_prediction_prewarm job (every 4 min).
"""

from __future__ import annotations

import asyncio
from datetime import datetime

from app.services.binance_service import PERIODS as BINANCE_PERIODS
from app.services.binance_service import get_klines
from app.services.crypto_service import TRACKED_COINS, get_quotes
from app.services.mcx_prediction_service import _slope_momentum_atr

PREDICT_HORIZON = 10
MIN_CANDLES = 20

# The 3 timeframes shown in the Ranked Crypto Prediction table -- a
# spread from short-term to daily. Chart period selector itself offers
# the full BINANCE_PERIODS set (see crypto.py); this is deliberately
# narrower to keep the table compact, same reasoning as MCX's My Trading
# Dashboard picking 4 columns instead of every period it tracks.
RANKED_PERIODS: tuple[str, ...] = ("15m", "1h", "1D")


async def get_prediction(coin: str, period: str = "30m") -> dict:
    candles = await get_klines(coin, period)
    bucket = BINANCE_PERIODS[period][1]

    if len(candles) < MIN_CANDLES:
        return {
            "coin": coin.upper(),
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
        "coin": coin.upper(),
        "period": period,
        "generated_at": datetime.utcnow().isoformat(),
        "last_actual_time": last_time,
        "last_actual_close": last_close,
        "predicted": predicted,
        "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, not a trained model)",
    }


async def _nearest_predicted(coin: str, period: str) -> float | None:
    try:
        pred = await get_prediction(coin, period)
        predicted = pred.get("predicted") or []
        return predicted[0]["predicted_close"] if predicted else None
    except Exception:
        return None


async def get_ranked_predictions() -> dict:
    """Every tracked coin's LTP/24H change plus its nearest predicted price
    at each RANKED_PERIODS timeframe, ranked by 24H change descending (same
    "heat map" ordering as the quote tiles -- no AI score to rank by here,
    unlike MCX's My Trading Dashboard)."""
    quotes = await get_quotes()
    quotes_by_code = {q["code"]: q for q in quotes}

    async def _row(code: str) -> dict:
        preds = await asyncio.gather(*[_nearest_predicted(code, p) for p in RANKED_PERIODS])
        quote = quotes_by_code.get(code)
        return {
            "code": code,
            "name": quote["name"] if quote else code,
            "price": quote["price"] if quote else None,
            "price_usd": quote.get("price_usd") if quote else None,
            "change_pct_24h": quote.get("change_pct_24h") if quote else None,
            "predicted": dict(zip(RANKED_PERIODS, preds, strict=True)),
        }

    rows = await asyncio.gather(*[_row(code) for code in TRACKED_COINS])

    def _sort_key(row: dict) -> float:
        pct = row["change_pct_24h"]
        return pct if pct is not None else float("-inf")

    rows.sort(key=_sort_key, reverse=True)
    return {"generated_at": datetime.utcnow().isoformat(), "ranked": rows}
