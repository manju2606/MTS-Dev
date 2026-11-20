"""Multi-timeframe confirmation. Pure Python.

The higher timeframe (daily) sets the bias. The lower timeframe (hourly) must agree
before a signal counts as confirmed. Disagreement is reported explicitly, never
averaged away.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.domain.services.liquidity_flow.engine import LiquidityAnalysis


@dataclass(frozen=True)
class MTSConfirmation:
    higher_signal: str
    lower_signal: str
    higher_trend: str
    lower_trend: str
    aligned: bool
    verdict: str  # CONFIRMED BUY | CONFIRMED SELL | CONFLICT | NO_EDGE | WAIT_LOWER_TF
    note: str


def mtf_confirmation(higher: LiquidityAnalysis, lower: LiquidityAnalysis) -> MTSConfirmation:
    hs = higher.recommendation["signal"]
    ls = lower.recommendation["signal"]
    if hs == "HOLD" and ls == "HOLD":
        verdict, note = "NO_EDGE", "Neither timeframe shows a tradeable setup."
    elif hs == "HOLD":
        verdict, note = (
            "WAIT_LOWER_TF",
            (
                f"Higher timeframe has no setup; the lower timeframe says {ls}. "
                "Do not act on it alone."
            ),
        )
    elif ls == "HOLD":
        verdict, note = (
            "WAIT_LOWER_TF",
            (f"Higher timeframe says {hs}; the lower timeframe has not confirmed yet."),
        )
    elif hs == ls:
        verdict, note = f"CONFIRMED {hs}", f"Both timeframes say {hs}."
    else:
        verdict, note = (
            "CONFLICT",
            (f"Higher timeframe says {hs} but lower says {ls}. Stand aside."),
        )
    return MTSConfirmation(
        higher_signal=hs,
        lower_signal=ls,
        higher_trend=higher.trend,
        lower_trend=lower.trend,
        aligned=(hs == ls and hs != "HOLD"),
        verdict=verdict,
        note=note,
    )
