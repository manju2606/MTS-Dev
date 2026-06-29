"""Weighted scoring engine — produces a 0-100 composite StockScore.

Weights:
  technical  40 %
  news       30 %
  ml         20 %
  social     10 %
"""

import asyncio
from datetime import datetime

import structlog

from app.domain.models.discovery import StockScore
from app.domain.models.quote import Quote
from app.infra.ai.technical import TechnicalIndicators, fetch_indicators
from app.infra.discovery.breakout_scanner import compute_technical_score, detect_patterns
from app.infra.discovery.sentiment import normalize_to_100
from app.infra.discovery.social_stubs import aggregate_social_score
from app.infra.market_data.yfinance_client import YFinanceClient

log = structlog.get_logger()

_W_TECHNICAL = 0.40
_W_NEWS = 0.30
_W_ML = 0.20
_W_SOCIAL = 0.10

_SCAN_SEMAPHORE: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    global _SCAN_SEMAPHORE
    if _SCAN_SEMAPHORE is None:
        _SCAN_SEMAPHORE = asyncio.Semaphore(10)
    return _SCAN_SEMAPHORE


def _signal_from_score(score: float) -> str:
    if score >= 75:
        return "STRONG_BUY"
    if score >= 60:
        return "BUY"
    if score >= 50:
        return "WATCH"
    if score >= 40:
        return "NEUTRAL"
    if score >= 25:
        return "SELL"
    return "STRONG_SELL"


def _confidence_from_score(score: float) -> float:
    dist = abs(score - 50)
    return round(min(0.92, 0.40 + dist / 50 * 0.52), 2)


def _price_levels(
    signal: str,
    quote: Quote,
    ta: TechnicalIndicators,
) -> tuple[float, float, list[float], str, float]:
    """Return (entry, stop, [T1,T2,T3], holding_period, r_r)."""
    atr = max(ta.atr_14, quote.price * 0.005)
    entry = quote.price

    if signal in ("STRONG_BUY", "BUY", "WATCH"):
        stop = round(entry - 1.5 * atr, 2)
        t1 = round(entry + 2.0 * atr, 2)
        t2 = round(entry + 3.5 * atr, 2)
        t3 = round(entry + 5.0 * atr, 2)
    else:
        stop = round(entry + 1.5 * atr, 2)
        t1 = round(entry - 2.0 * atr, 2)
        t2 = round(entry - 3.5 * atr, 2)
        t3 = round(entry - 5.0 * atr, 2)

    risk = abs(entry - stop)
    reward = abs(t1 - entry)
    rr = round(reward / risk, 2) if risk > 0 else 1.33

    atr_pct = atr / entry * 100
    if atr_pct > 3:
        holding = "1–2 days"
    elif atr_pct > 1.5:
        holding = "2–4 days"
    else:
        holding = "3–7 days"

    return entry, stop, [t1, t2, t3], holding, rr


def _build_explanation(
    symbol: str,
    signal: str,
    tech_score: float,
    news_score: float,
    ml_score: float,
    patterns: list[tuple[str, str, float]],
    news_summary: str,
) -> str:
    top_patterns = sorted(patterns, key=lambda x: x[2], reverse=True)[:2]
    pattern_text = "; ".join(p[1] for p in top_patterns) if top_patterns else "No strong patterns"
    return (
        f"{signal}: Technical {tech_score:.0f}/100 · News {news_score:.0f}/100 · ML {ml_score:.0f}/100. "
        f"Key signals: {pattern_text}."
        + (f" News: {news_summary}" if news_summary else "")
    )


async def score_stock(
    symbol: str,
    name: str,
    news_sentiment: float,  # -1..+1 average for this symbol
) -> StockScore | None:
    """Score a single stock. Returns None if data unavailable."""
    async with _get_semaphore():
        try:
            client = YFinanceClient()
            quote, ta = await asyncio.gather(
                client.get_quote(symbol),
                fetch_indicators(symbol),
            )
        except Exception as exc:
            log.debug("discovery.score.skip", symbol=symbol, reason=str(exc))
            return None

    # Technical
    patterns = detect_patterns(symbol, quote, ta)
    tech_score = compute_technical_score(quote, ta, patterns)

    # News
    news_score = normalize_to_100(news_sentiment)

    # ML
    ml_score = 50.0
    try:
        from app.infra.ml.predictor import predict
        ml_pred = await asyncio.wait_for(predict(symbol), timeout=15.0)
        ml_score = 72.0 if ml_pred.prediction == "UP" else 28.0
    except Exception:
        pass

    # Social (stubs → 50)
    social_score, _ = await aggregate_social_score(symbol)

    # Composite
    composite = (
        tech_score * _W_TECHNICAL
        + news_score * _W_NEWS
        + ml_score * _W_ML
        + social_score * _W_SOCIAL
    )
    composite = round(min(100.0, max(0.0, composite)), 1)

    signal = _signal_from_score(composite)
    confidence = _confidence_from_score(composite)
    entry, stop, targets, holding, rr = _price_levels(signal, quote, ta)

    pattern_labels = [p[1] for p in sorted(patterns, key=lambda x: x[2], reverse=True)[:5]]

    explanation = _build_explanation(
        symbol, signal, tech_score, news_score, ml_score,
        patterns, ""
    )

    return StockScore(
        symbol=symbol,
        name=name,
        score=composite,
        signal=signal,
        confidence=confidence,
        entry_price=round(entry, 2),
        stop_loss=round(stop, 2),
        targets=targets,
        holding_period=holding,
        risk_reward_ratio=rr,
        technical_score=tech_score,
        news_score=news_score,
        ml_score=ml_score,
        social_score=social_score,
        patterns=pattern_labels,
        news_summary="",
        explanation=explanation,
        scanned_at=datetime.utcnow(),
    )
