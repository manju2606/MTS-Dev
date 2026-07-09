"""Short-horizon MCX price forecast: a lightweight local extrapolator (EMA
slope + ROC momentum + an ATR-based uncertainty cone), not literally Google
TimesFM. TimesFM needs Python <=3.11 with PyTorch/JAX and a ~200-500MB model
checkpoint -- this backend runs Python 3.14 with no GPU in the Docker setup,
so real TimesFM inference would need a separate service and would be slow
(seconds, not ms) per call. This gives the same functional shape instead --
a predicted path in a distinct colour per chart timeframe, plus a tracked
hit-rate -- using data already computed for the AI score (ng_indicators.py).

Not a real forecasting model: it's a straight-line projection of the recent
EMA20 slope, damped or reinforced by whether momentum (ROC) agrees with that
slope, with a widening ATR-based band standing in for uncertainty. Treat the
predicted path as a visual aid, not a trading signal on its own.
"""

from __future__ import annotations

from datetime import datetime

from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
from app.infra.mcx import ng_indicators as ind
from app.services.mcx_service import get_history

# Real candle-bucket width in seconds per period -- mirrors
# mcx_service._HISTORY_PERIOD_MAP's actual Kite interval choice (e.g. "30m"
# is built from 15-minute candles, not 30-minute ones).
PERIOD_BUCKET_SECONDS: dict[str, int] = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 900,
    "45m": 3600,
    "1h": 3600,
    "1D": 86400,
    "5D": 86400,
    "1W": 86400,
    "1M": 86400,
    "3M": 86400,
    "6M": 86400,
    "1Y": 86400,
}

HORIZON = 6  # number of future candles to project, at the chart's own bucket size
MIN_CANDLES = 25


async def get_prediction(
    user_id: str, contract: str, period: str, repo: McxPredictionRepository
) -> dict:
    candles = await get_history(user_id, period, contract)
    bucket = PERIOD_BUCKET_SECONDS.get(period, 86400)

    await repo.resolve_pending(user_id, contract, period, candles)
    accuracy = await repo.get_accuracy_stats(user_id, contract, period)

    if len(candles) < MIN_CANDLES:
        return {
            "contract": contract.upper(),
            "period": period,
            "predicted": [],
            "accuracy": accuracy,
            "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, not TimesFM)",
            "note": f"Need at least {MIN_CANDLES} candles for a forecast (have {len(candles)}).",
        }

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

    last_time = int(candles[-1]["time"])
    last_close = c[-1]

    predicted = []
    for i in range(1, HORIZON + 1):
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

    await repo.save_predictions(user_id, contract, period, predicted)

    return {
        "contract": contract.upper(),
        "period": period,
        "generated_at": datetime.utcnow().isoformat(),
        "last_actual_time": last_time,
        "last_actual_close": round(last_close, 2),
        "predicted": predicted,
        "accuracy": accuracy,
        "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, not TimesFM)",
    }
