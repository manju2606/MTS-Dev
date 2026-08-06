"""Multi-timeframe price forecast for the day's Golden Egg pick -- the same
EMA20-slope + ROC-momentum + ATR-cone heuristic as mcx_prediction_service.py
(see that module's docstring for why this isn't literally TimesFM), applied
to NSE cash-equity candles (yfinance) at whichever timeframe the chart is
showing: 5m/15m/30m/1h/2h/4h intraday, or 1D/1W/1M.

day/week/month-scale ML forecasts for the same symbol come from the
existing, more sophisticated ensemble (forecast_service.generate_forecast,
already seeded by golden_egg_service.send_golden_egg_email) -- this module
exists for the chart's own short-horizon overlay at whichever timeframe is
selected, not to duplicate that.

Also returns day/month high-low so the chart can draw them as reference
lines -- day high/low comes from the live quote (today's own candle isn't
closed yet), month high/low from daily candle history, the same sourcing
as mcx_service.get_range_stats uses for MCX contracts.

Predictions/accuracy persist via the existing McxPredictionRepository under
a pseudo-user ("golden_egg") with the picked symbol as `contract` -- the
same reuse pattern as mcx_prediction_service's own get_global_prediction:
this data isn't tied to anyone's Zerodha session (yfinance is the same feed
for everyone), and the repository is keyed on plain (user_id, contract,
period) strings, so this can't collide with any real MCX contract's own
predictions.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from app.infra.db.repositories.mcx_prediction_repo import McxPredictionRepository
from app.infra.mcx import ng_indicators as ind

IST = timezone(timedelta(hours=5, minutes=30))

GOLDEN_EGG_PREDICTION_USER = "golden_egg"
MIN_CANDLES = 20

# yfinance interval/lookback per period, the real bucket width in seconds,
# how many future buckets to project, and (2h/4h only, which yfinance has
# no native interval for -- 60m is its finest above 30m) how many
# consecutive 60m bars to merge into one.
_PERIOD_CONFIG: dict[str, dict] = {
    "5m": {"yf_interval": "5m", "yf_period": "60d", "bucket_seconds": 300, "horizon": 12},
    "15m": {"yf_interval": "15m", "yf_period": "60d", "bucket_seconds": 900, "horizon": 12},
    "30m": {"yf_interval": "30m", "yf_period": "60d", "bucket_seconds": 1800, "horizon": 12},
    "1h": {"yf_interval": "60m", "yf_period": "730d", "bucket_seconds": 3600, "horizon": 8},
    "2h": {"yf_interval": "60m", "yf_period": "730d", "bucket_seconds": 7200, "horizon": 8, "merge": 2},
    "4h": {"yf_interval": "60m", "yf_period": "730d", "bucket_seconds": 14400, "horizon": 8, "merge": 4},
    "1D": {"yf_interval": "1d", "yf_period": "2y", "bucket_seconds": 86400, "horizon": 10},
    "1W": {"yf_interval": "1wk", "yf_period": "5y", "bucket_seconds": 604800, "horizon": 8},
    "1M": {"yf_interval": "1mo", "yf_period": "10y", "bucket_seconds": 2_592_000, "horizon": 6},
}
DEFAULT_PERIOD = "1h"


def _merge_candles(candles: list[dict], n: int) -> list[dict]:
    """Aggregate every `n` consecutive candles into one OHLC bar."""
    out = []
    for i in range(0, len(candles) - n + 1, n):
        chunk = candles[i : i + n]
        out.append(
            {
                "time": chunk[0]["time"],
                "open": chunk[0]["open"],
                "high": max(c["high"] for c in chunk),
                "low": min(c["low"] for c in chunk),
                "close": chunk[-1]["close"],
                "volume": sum(c.get("volume", 0) for c in chunk),
            }
        )
    return out


async def _fetch_candles(symbol: str, period: str) -> list[dict]:
    import yfinance as yf

    cfg = _PERIOD_CONFIG[period]

    def _sync() -> list[dict]:
        df = yf.Ticker(symbol).history(period=cfg["yf_period"], interval=cfg["yf_interval"])
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

    candles = await asyncio.to_thread(_sync)
    merge = cfg.get("merge")
    return _merge_candles(candles, merge) if merge else candles


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


async def _range_stats(symbol: str, period: str, candles: list[dict]) -> dict:
    """Day high/low (from the live quote -- today's own candle isn't closed
    yet) and month high/low (from daily candle history) -- same sourcing as
    mcx_service.get_range_stats, adapted for an NSE equity via yfinance
    instead of a live Kite session."""
    from app.infra.market_data.yfinance_client import YFinanceClient

    try:
        quote = await YFinanceClient().get_quote(symbol)
        day_high, day_low = quote.day_high, quote.day_low
    except Exception:
        day_high, day_low = None, None

    daily = candles if period == "1D" else await _fetch_candles(symbol, "1D")

    today = datetime.now(IST).date()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    week_candles = [
        c for c in daily if datetime.fromtimestamp(c["time"], tz=IST).date() >= week_start
    ]
    month_candles = [
        c for c in daily if datetime.fromtimestamp(c["time"], tz=IST).date() >= month_start
    ]

    def _high(cs: list[dict]) -> float | None:
        highs = [c["high"] for c in cs] + ([day_high] if day_high else [])
        return max(highs) if highs else None

    def _low(cs: list[dict]) -> float | None:
        lows = [c["low"] for c in cs if c["low"] > 0] + ([day_low] if day_low else [])
        return min(lows) if lows else None

    week_high, week_low = _high(week_candles), _low(week_candles)
    month_high, month_low = _high(month_candles), _low(month_candles)

    return {
        "day_high": round(day_high, 2) if day_high else None,
        "day_low": round(day_low, 2) if day_low else None,
        "week_high": round(week_high, 2) if week_high else None,
        "week_low": round(week_low, 2) if week_low else None,
        "month_high": round(month_high, 2) if month_high else None,
        "month_low": round(month_low, 2) if month_low else None,
    }


async def get_prediction(symbol: str, period: str, repo: McxPredictionRepository) -> dict:
    if period not in _PERIOD_CONFIG:
        period = DEFAULT_PERIOD
    cfg = _PERIOD_CONFIG[period]

    candles = await _fetch_candles(symbol, period)

    await repo.resolve_pending(GOLDEN_EGG_PREDICTION_USER, symbol, period, candles)
    accuracy = await repo.get_accuracy_stats(GOLDEN_EGG_PREDICTION_USER, symbol, period)
    range_stats = await _range_stats(symbol, period, candles)

    if len(candles) < MIN_CANDLES:
        return {
            "symbol": symbol,
            "period": period,
            "candles": candles,
            "predicted": [],
            "history": _serialize_history(
                await repo.get_recent(GOLDEN_EGG_PREDICTION_USER, symbol, period)
            ),
            "accuracy": accuracy,
            **range_stats,
            "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, not TimesFM)",
            "note": f"Need at least {MIN_CANDLES} candles for a forecast (have {len(candles)}).",
        }

    last_time = int(candles[-1]["time"])
    last_close = float(candles[-1]["close"])
    slope, _momentum, atr_val, conviction = _slope_momentum_atr(candles)

    predicted = []
    bucket = cfg["bucket_seconds"]
    for i in range(1, cfg["horizon"] + 1):
        t = last_time + i * bucket
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

    await repo.save_predictions(GOLDEN_EGG_PREDICTION_USER, symbol, period, predicted)
    history = _serialize_history(
        await repo.get_recent(GOLDEN_EGG_PREDICTION_USER, symbol, period, limit=200)
    )

    return {
        "symbol": symbol,
        "period": period,
        "candles": candles,
        "generated_at": datetime.utcnow().isoformat(),
        "last_actual_time": last_time,
        "last_actual_close": round(last_close, 2),
        "predicted": predicted,
        "history": history,
        "accuracy": accuracy,
        **range_stats,
        "method": "ema20-slope + roc-momentum + atr-cone (local heuristic, not TimesFM)",
    }
