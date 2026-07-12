"""International Market dashboard -- ranks major global market indices
(S&P 500, Nasdaq, FTSE 100, Nikkei 225, etc. -- see
global_indices_service.TRACKED_INDICES) by a derived Trend/AI
Score/Confidence.

All three are sourced from the same local heuristic (EMA20 slope + ROC
momentum + ATR-based conviction) the USA Stocks price chart's AI
Prediction band already uses -- see
mcx_prediction_service._slope_momentum_atr, reused across MCX/Crypto/USA
Stocks/Global Indices. This is explicitly NOT the fuller technicals +
news-sentiment + cross-market-correlation AI Score MCX's own My Trading
Dashboard computes (compute_ng_ai_score/compute_metal_ai_score) -- that
pipeline is India-news- and Kite-specific; replicating it for global
indices would need a whole new news source and correlation model per
market, out of scope here. The score below is a simpler, clearly-labeled
derivation of the same slope/momentum signal already driving predictions
elsewhere in this app.

Uses the "1D" period as the representative timeframe for Trend/AI Score/
Confidence -- global_indices_service has no dedicated prewarm job (only
15 tickers, cheap enough to fetch cold), so this dashboard's first load
after a cache TTL expiry pays that cost directly.
"""

from __future__ import annotations

import asyncio
from datetime import datetime

from app.services.global_indices_service import TRACKED_INDICES, get_klines, get_quotes
from app.services.mcx_prediction_service import _slope_momentum_atr

TREND_PERIOD = "1D"
MIN_CANDLES = 20

METHOD = "ema20-slope + roc-momentum + atr-conviction (local heuristic, not a trained model)"


def _derive_score(slope: float, momentum: float, conviction: float) -> tuple[str, int, int]:
    """(trend, ai_score 0-100, confidence_pct) from the heuristic's own
    outputs. `conviction` is a binary multiplier (1.15 when slope and
    momentum agree in direction, 0.65 when they disagree -- see
    _slope_momentum_atr's own docstring), mapped here to a 0-100
    confidence rather than shown as that raw multiplier, which would be a
    meaningless-looking number on a dashboard."""
    if slope > 0:
        trend = "Bullish"
    elif slope < 0:
        trend = "Bearish"
    else:
        trend = "Neutral"

    agreement = conviction >= 1.0
    confidence_pct = 80 if agreement else 40

    direction_bonus = (20 if agreement else -20) if trend != "Neutral" else 0
    momentum_bonus = min(abs(momentum) * 4, 20)
    ai_score = max(0, min(100, round(50 + direction_bonus + momentum_bonus)))
    return trend, ai_score, confidence_pct


async def _score_one(code: str) -> dict | None:
    candles = await get_klines(code, TREND_PERIOD)
    if len(candles) < MIN_CANDLES:
        return None
    slope, momentum, _atr_val, conviction = _slope_momentum_atr(candles)
    trend, ai_score, confidence_pct = _derive_score(slope, momentum, conviction)
    return {"code": code, "trend": trend, "ai_score": ai_score, "confidence_pct": confidence_pct}


async def get_dashboard() -> dict:
    quotes = await get_quotes()
    quotes_by_code = {q["code"]: q for q in quotes}

    async def _safe_score(code: str) -> dict | None:
        try:
            return await _score_one(code)
        except Exception:
            return None

    scored = await asyncio.gather(*[_safe_score(c) for c in TRACKED_INDICES])
    rows = []
    for s in scored:
        if s is None:
            continue
        quote = quotes_by_code.get(s["code"])
        info = TRACKED_INDICES[s["code"]]
        rows.append(
            {
                **s,
                "name": info["name"],
                "region": info["region"],
                "price": quote["price"] if quote else None,
                "change_pct": quote["change_pct"] if quote else None,
            }
        )
    rows.sort(key=lambda r: r["ai_score"], reverse=True)

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "period": TREND_PERIOD,
        "method": METHOD,
        "ranked": rows,
    }
