"""Rule-based AI engine — full recommendation with no API key required.

Uses RSI, MACD, SMA trend, Bollinger Bands, and ATR to score bullish/bearish
pressure, then derives entry/stop/target from ATR-based levels.
"""

from app.domain.models.quote import Quote
from app.domain.models.recommendation import AIRecommendation
from app.infra.ai.technical import TechnicalIndicators


def _analyze(symbol: str, quote: Quote, ta: TechnicalIndicators) -> AIRecommendation:
    bull = 0
    bear = 0
    reasons: list[str] = []

    # 1. SMA trend (weighted ×2)
    if ta.trend == "uptrend":
        bull += 2
        reasons.append("SMA-20 > SMA-50 and price above both (uptrend)")
    elif ta.trend == "downtrend":
        bear += 2
        reasons.append("SMA-20 < SMA-50 and price below both (downtrend)")
    else:
        reasons.append("Price in sideways consolidation")

    # 2. RSI (weighted ×2 at extremes)
    if ta.rsi_14 < 35:
        bull += 2
        reasons.append(f"RSI {ta.rsi_14:.0f} — oversold, bounce likely")
    elif ta.rsi_14 > 65:
        bear += 2
        reasons.append(f"RSI {ta.rsi_14:.0f} — overbought, pullback likely")
    elif ta.rsi_14 >= 50:
        bull += 1
    else:
        bear += 1

    # 3. MACD vs signal
    if ta.macd > ta.macd_signal:
        bull += 1
        reasons.append("MACD above signal line (bullish momentum)")
    else:
        bear += 1
        reasons.append("MACD below signal line (bearish momentum)")

    # 4. Bollinger Band position
    if quote.price <= ta.bb_lower * 1.005:
        bull += 1
        reasons.append("Price at lower Bollinger Band — mean-reversion opportunity")
    elif quote.price >= ta.bb_upper * 0.995:
        bear += 1
        reasons.append("Price at upper Bollinger Band — potential reversal")

    # 5. Price vs SMA-20
    if ta.price_vs_sma20_pct < -3:
        bull += 1  # extended below, bounce candidate
    elif ta.price_vs_sma20_pct > 3:
        bear += 1  # extended above, pullback candidate

    # 6. Volume confirmation
    if ta.volume_ratio > 1.5:
        if quote.change_pct > 0:
            bull += 1
            reasons.append(f"Strong volume ({ta.volume_ratio:.1f}× avg) confirms upward move")
        else:
            bear += 1
            reasons.append(f"Strong volume ({ta.volume_ratio:.1f}× avg) confirms downward move")

    total = bull + bear
    bull_ratio = bull / total if total > 0 else 0.5

    if bull_ratio >= 0.62:
        signal = "BUY"
        confidence = round(min(0.82, 0.45 + bull_ratio * 0.55), 2)
    elif bull_ratio <= 0.38:
        signal = "SELL"
        confidence = round(min(0.82, 0.45 + (1 - bull_ratio) * 0.55), 2)
    else:
        signal = "HOLD"
        confidence = round(0.45 + abs(bull_ratio - 0.5) * 0.3, 2)

    # ATR-based price levels
    atr = max(ta.atr_14, quote.price * 0.005)  # floor at 0.5% to avoid zero
    entry = quote.price

    if signal == "BUY":
        stop_loss = round(entry - 1.5 * atr, 2)
        target = round(entry + 2.5 * atr, 2)
    elif signal == "SELL":
        stop_loss = round(entry + 1.5 * atr, 2)
        target = round(entry - 2.5 * atr, 2)
    else:
        stop_loss = round(entry - 1.5 * atr, 2)
        target = round(entry + 2.5 * atr, 2)

    risk = abs(entry - stop_loss)
    reward = abs(target - entry)
    rr = round(reward / risk, 2) if risk > 0 else 1.67

    atr_pct = atr / entry * 100
    holding = "1–2 days" if atr_pct > 3 else "2–4 days" if atr_pct > 1.5 else "3–5 days"

    top = reasons[:2]
    explanation = f"{top[0]}." if top else "Mixed signals."
    if len(top) > 1:
        explanation += f" {top[1]}."

    return AIRecommendation(
        symbol=symbol,
        signal=signal,
        confidence=confidence,
        entry_price=round(entry, 2),
        stop_loss=stop_loss,
        target=target,
        risk_reward_ratio=rr,
        holding_period=holding,
        explanation=explanation,
        engine="local",
    )


class LocalAIClient:
    """Synchronous rule-based engine with the same interface as ClaudeAIClient."""

    async def analyze(self, symbol: str, quote: Quote, ta: TechnicalIndicators) -> AIRecommendation:
        return _analyze(symbol, quote, ta)
