"""Detect technical breakout patterns from TechnicalIndicators.

Returns a list of (pattern_name, description, strength) tuples.
Reuses the existing fetch_indicators() function so all TA logic stays in
one place.
"""

from app.domain.models.quote import Quote
from app.infra.ai.technical import TechnicalIndicators


def detect_patterns(
    symbol: str,
    quote: Quote,
    ta: TechnicalIndicators,
) -> list[tuple[str, str, float]]:
    """Return list of (name, description, strength 0..1) for all patterns triggered."""
    patterns: list[tuple[str, str, float]] = []
    p = quote.price

    # 1. RSI oversold recovery — high-probability mean reversion
    if ta.rsi_14 < 35:
        strength = min(1.0, (35 - ta.rsi_14) / 20)
        patterns.append(("rsi_oversold", f"RSI {ta.rsi_14:.0f} — deeply oversold (< 35)", strength))

    # 2. RSI overbought — momentum exhaustion warning
    if ta.rsi_14 > 65:
        strength = min(1.0, (ta.rsi_14 - 65) / 20)
        patterns.append(("rsi_overbought", f"RSI {ta.rsi_14:.0f} — overbought (> 65)", strength))

    # 3. RSI momentum zone — mid-trend confirmation
    if 50 <= ta.rsi_14 <= 65:
        patterns.append(("rsi_momentum", f"RSI {ta.rsi_14:.0f} — bullish momentum zone", 0.4))

    # 4. MACD bullish crossover (MACD > Signal)
    if ta.macd > ta.macd_signal and abs(ta.macd - ta.macd_signal) < abs(ta.macd) * 0.5:
        patterns.append(("macd_bullish", "MACD above signal line — bullish crossover", 0.65))

    # 5. MACD bearish crossover (MACD < Signal)
    if ta.macd < ta.macd_signal and abs(ta.macd_signal - ta.macd) < abs(ta.macd_signal) * 0.5:
        patterns.append(("macd_bearish", "MACD below signal line — bearish crossover", 0.65))

    # 6. Volume surge — institutional activity
    if ta.volume_ratio >= 2.0:
        strength = min(1.0, (ta.volume_ratio - 2.0) / 3.0 + 0.6)
        dir_label = "buying" if quote.change_pct >= 0 else "selling"
        patterns.append(
            (
                "volume_surge",
                f"Volume {ta.volume_ratio:.1f}× avg — strong {dir_label} interest",
                strength,
            )
        )

    # 7. Bollinger Band upper breakout — momentum continuation
    if p >= ta.bb_upper * 0.998:
        patterns.append(
            ("bb_upper_break", f"Price at/above upper Bollinger Band (₹{ta.bb_upper:.2f})", 0.7)
        )

    # 8. Bollinger Band lower bounce — mean-reversion entry
    if p <= ta.bb_lower * 1.002:
        patterns.append(
            ("bb_lower_bounce", f"Price at/below lower Bollinger Band (₹{ta.bb_lower:.2f})", 0.7)
        )

    # 9. Strong uptrend — SMA20 > SMA50, price above both
    if ta.trend == "uptrend" and ta.price_vs_sma20_pct > 0:
        patterns.append(
            ("uptrend_confirmed", "SMA-20 > SMA-50, price above both — strong uptrend", 0.6)
        )

    # 10. Strong downtrend — SMA20 < SMA50, price below both
    if ta.trend == "downtrend" and ta.price_vs_sma20_pct < 0:
        patterns.append(
            ("downtrend_confirmed", "SMA-20 < SMA-50, price below both — strong downtrend", 0.6)
        )

    # 11. Price extended above SMA-20 (potential pullback)
    if ta.price_vs_sma20_pct > 5:
        patterns.append(
            (
                "extended_above_sma",
                f"Price {ta.price_vs_sma20_pct:.1f}% above SMA-20 — extended, pullback risk",
                0.4,
            )
        )

    # 12. Price far below SMA-20 (bounce candidate)
    if ta.price_vs_sma20_pct < -5:
        patterns.append(
            (
                "deep_below_sma",
                f"Price {abs(ta.price_vs_sma20_pct):.1f}% below SMA-20 — deep discount",
                0.5,
            )
        )

    # 13. Bollinger Band squeeze — low volatility, breakout imminent
    bb_width = (ta.bb_upper - ta.bb_lower) / ta.sma_20 if ta.sma_20 > 0 else 0
    if bb_width < 0.04:  # < 4% band width indicates squeeze
        patterns.append(
            (
                "bb_squeeze",
                f"Bollinger Band width {bb_width:.1%} — volatility squeeze, breakout imminent",
                0.55,
            )
        )

    # 14. Bullish convergence — all three main signals align
    bull_count = sum(
        [
            ta.rsi_14 > 50,
            ta.macd > ta.macd_signal,
            ta.trend == "uptrend",
        ]
    )
    if bull_count == 3:
        patterns.append(
            (
                "full_bullish_alignment",
                "RSI > 50, MACD bullish, uptrend — full bullish convergence",
                0.8,
            )
        )

    # 15. Bearish convergence — all three main signals align bearishly
    bear_count = sum(
        [
            ta.rsi_14 < 50,
            ta.macd < ta.macd_signal,
            ta.trend == "downtrend",
        ]
    )
    if bear_count == 3:
        patterns.append(
            (
                "full_bearish_alignment",
                "RSI < 50, MACD bearish, downtrend — full bearish convergence",
                0.8,
            )
        )

    return patterns


def compute_technical_score(
    quote: Quote,
    ta: TechnicalIndicators,
    patterns: list[tuple[str, str, float]],
) -> float:
    """Compute 0–100 technical score from TA signals and detected patterns."""
    bull = 0.0
    bear = 0.0

    # RSI
    if ta.rsi_14 < 35:
        bull += 2
    elif ta.rsi_14 > 65:
        bear += 2
    elif ta.rsi_14 >= 50:
        bull += 1
    else:
        bear += 1

    # SMA trend
    if ta.trend == "uptrend":
        bull += 2
    elif ta.trend == "downtrend":
        bear += 2

    # MACD
    if ta.macd > ta.macd_signal:
        bull += 1
    else:
        bear += 1

    # Bollinger position
    if quote.price <= ta.bb_lower * 1.005:
        bull += 1
    elif quote.price >= ta.bb_upper * 0.995:
        bear += 1

    # SMA-20 distance
    if ta.price_vs_sma20_pct < -3:
        bull += 0.5
    elif ta.price_vs_sma20_pct > 3:
        bear += 0.5

    # Volume
    if ta.volume_ratio > 1.5:
        if quote.change_pct > 0:
            bull += 1
        else:
            bear += 1

    # Pattern bonus: positive patterns push score up, negative push down
    bullish_patterns = {
        "rsi_oversold",
        "rsi_momentum",
        "macd_bullish",
        "volume_surge",
        "bb_lower_bounce",
        "uptrend_confirmed",
        "deep_below_sma",
        "full_bullish_alignment",
        "bb_squeeze",
    }
    bearish_patterns = {
        "rsi_overbought",
        "macd_bearish",
        "bb_upper_break",
        "downtrend_confirmed",
        "extended_above_sma",
        "full_bearish_alignment",
    }

    for name, _, strength in patterns:
        if name in bullish_patterns:
            bull += strength * 0.5
        elif name in bearish_patterns:
            bear += strength * 0.5

    total = bull + bear
    if total == 0:
        return 50.0
    bull_ratio = bull / total
    return round(bull_ratio * 100, 1)
