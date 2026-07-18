"""Combinatorial strategy generation -- builds StrategyCandidate objects by
crossing a curated set of signal-template families (each a real, standard
technical strategy shape) with parameter grids and a small risk-management
grid (stop loss / target / trailing stop). engine.py interprets `family` +
`params` to actually evaluate entries/exits; this module only produces the
candidate definitions.

Deliberately NOT "thousands" of candidates via full-precision parameter
sweeps (e.g. every RSI period 2-50) -- that inflates count without adding
real diversity and makes each run too slow without a job queue (out of
scope for this v1, see conversation). Each family's grid is a handful of
genuinely distinct, commonly-used parameter sets.
"""

from __future__ import annotations

from itertools import product

from app.domain.models.strategy_lab import StrategyCandidate

# Risk-management grid crossed with every signal family below.
_STOP_LOSS_GRID = [1.5, 2.5]
_TARGET_GRID = [3.0, 5.0]
_TRAILING_GRID: list[float | None] = [None, 2.0]
_POSITION_SIZE_PCT = 2.0  # % of capital risked per trade, fixed for v1


def _risk_variants() -> list[dict]:
    return [
        {"stop_loss_pct": sl, "target_pct": tg, "trailing_stop_pct": tr}
        for sl, tg, tr in product(_STOP_LOSS_GRID, _TARGET_GRID, _TRAILING_GRID)
    ]


def _make(
    family: str, base_name: str, description: str, params: dict[str, float | int]
) -> list[StrategyCandidate]:
    out = []
    for risk in _risk_variants():
        trail_label = f", trail {risk['trailing_stop_pct']}%" if risk["trailing_stop_pct"] else ""
        name = f"{base_name} (SL {risk['stop_loss_pct']}% / TG {risk['target_pct']}%{trail_label})"
        out.append(
            StrategyCandidate(
                id=StrategyCandidate.new_id(),
                name=name,
                family=family,
                description=description,
                params=params,
                stop_loss_pct=risk["stop_loss_pct"],
                target_pct=risk["target_pct"],
                trailing_stop_pct=risk["trailing_stop_pct"],
                position_size_pct=_POSITION_SIZE_PCT,
            )
        )
    return out


def generate_candidates(max_candidates: int = 400) -> list[StrategyCandidate]:
    candidates: list[StrategyCandidate] = []

    for fast, slow in [(9, 21), (9, 26), (9, 50), (12, 21), (12, 26), (12, 50), (20, 50)]:
        candidates += _make(
            "ema_crossover",
            f"EMA {fast}/{slow} Crossover",
            f"Buy when EMA-{fast} crosses above EMA-{slow} (golden cross); "
            f"exit on the reverse crossover.",
            {"fast": fast, "slow": slow},
        )

    for oversold, overbought in product([20, 25, 30], [65, 70, 75, 80]):
        candidates += _make(
            "rsi_reversion",
            f"RSI-14 Reversion ({oversold}/{overbought})",
            f"Buy when RSI-14 drops below {oversold} (oversold); "
            f"exit when RSI recovers above {overbought}.",
            {"period": 14, "oversold": oversold, "overbought": overbought},
        )

    for fast, slow, signal in [(12, 26, 9), (8, 17, 9), (5, 13, 6)]:
        candidates += _make(
            "macd_crossover",
            f"MACD {fast}/{slow}/{signal} Crossover",
            "Buy on bullish MACD/signal crossover; exit on bearish crossover.",
            {"fast": fast, "slow": slow, "signal": signal},
        )

    for num_std in [1.5, 2.0, 2.5]:
        candidates += _make(
            "bollinger_breakout",
            f"Bollinger Breakout ({num_std}σ)",
            f"Buy when price closes above the upper Bollinger Band ({num_std} "
            f"std-dev, 20-period); exit when price closes back below the midline.",
            {"period": 20, "num_std": num_std},
        )
        candidates += _make(
            "bollinger_reversion",
            f"Bollinger Reversion ({num_std}σ)",
            f"Buy when price closes below the lower Bollinger Band ({num_std} "
            f"std-dev, 20-period); exit at the midline.",
            {"period": 20, "num_std": num_std},
        )

    for period, mult in product([7, 10, 14], [2.0, 3.0, 4.0]):
        candidates += _make(
            "supertrend",
            f"SuperTrend {period}/{mult}",
            f"Buy when SuperTrend({period}, {mult}) flips to an uptrend; "
            f"exit when it flips back to a downtrend.",
            {"period": period, "multiplier": mult},
        )

    for period in [10, 20, 55]:
        candidates += _make(
            "donchian_breakout",
            f"Donchian {period}-bar Breakout",
            f"Buy when price closes above the {period}-bar highest high; "
            f"exit when price closes below the channel midline.",
            {"period": period},
        )

    for period, band in [(14, 100), (14, 150), (20, 100), (20, 150)]:
        candidates += _make(
            "cci_reversion",
            f"CCI-{period} Reversion (±{band})",
            f"Buy when CCI-{period} drops below -{band} (oversold); "
            f"exit when CCI rises above +{band}.",
            {"period": period, "band": band},
        )

    for atr_mult in [1.5, 2.0, 2.5]:
        candidates += _make(
            "keltner_breakout",
            f"Keltner Breakout (ATR x{atr_mult})",
            f"Buy when price closes above the upper Keltner Channel "
            f"(20-period, {atr_mult}x ATR); exit below the midline.",
            {"period": 20, "atr_mult": atr_mult},
        )

    for oversold, overbought in [(20, 80), (25, 75)]:
        candidates += _make(
            "stochastic_reversion",
            f"Stochastic Reversion ({oversold}/{overbought})",
            f"Buy when %K crosses back above {oversold} from below (oversold "
            f"recovery); exit when %K crosses below {overbought} from above.",
            {"k_period": 14, "d_period": 3, "oversold": oversold, "overbought": overbought},
        )

    return candidates[:max_candidates]
