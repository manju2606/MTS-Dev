"""Keyword-based sentiment scorer for financial news text."""

import re

_POSITIVE = {
    "surge", "rally", "breakout", "bullish", "strong", "beat", "beats",
    "growth", "profit", "gains", "record", "high", "upgrade", "outperform",
    "buy", "accumulate", "positive", "robust", "solid", "momentum", "rise",
    "jump", "soar", "boost", "uptick", "recovery", "rebound", "turnaround",
    "expansion", "increase", "improve", "improved", "exceeded", "upside",
    "overweight", "target", "potential", "opportunity", "optimistic",
    "dividend", "buyback", "acquisition", "deal", "contract", "order",
    "launch", "new", "innovation", "breakthrough",
}

_NEGATIVE = {
    "crash", "fall", "bearish", "weak", "miss", "misses", "loss", "losses",
    "decline", "plunge", "drop", "slump", "selloff", "sell-off", "downturn",
    "downgrade", "underperform", "sell", "reduce", "negative", "concern",
    "risk", "default", "debt", "trouble", "warning", "caution", "slowdown",
    "contraction", "decrease", "lower", "missed", "below", "downside",
    "underweight", "volatile", "uncertainty", "pressure", "headwind",
    "investigation", "fraud", "scam", "probe", "penalty", "fine", "lawsuit",
    "shortage", "supply", "disruption", "inflation", "rate hike",
}

_INTENSIFIERS = {"very", "highly", "significantly", "sharply", "major", "massive", "huge"}


def score_text(text: str) -> float:
    """Return sentiment score in [-1.0, +1.0]."""
    words = re.findall(r"\b\w+\b", text.lower())
    pos = neg = 0
    i = 0
    while i < len(words):
        w = words[i]
        multiplier = 2.0 if (i > 0 and words[i - 1] in _INTENSIFIERS) else 1.0
        if w in _POSITIVE:
            pos += multiplier
        elif w in _NEGATIVE:
            neg += multiplier
        # negation: "not strong" → flip
        if w == "not" and i + 1 < len(words):
            nxt = words[i + 1]
            if nxt in _POSITIVE:
                pos -= 1; neg += 1
            elif nxt in _NEGATIVE:
                neg -= 1; pos += 1
            i += 1
        i += 1

    total = pos + neg
    if total == 0:
        return 0.0
    return round((pos - neg) / total, 4)


def normalize_to_100(score: float) -> float:
    """Convert -1..+1 sentiment to 0..100 for composite scoring."""
    return round((score + 1.0) * 50.0, 1)
