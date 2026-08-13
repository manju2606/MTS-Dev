from dataclasses import dataclass


@dataclass
class ChartinkScoringConfig:
    """Tunable weights/thresholds behind the Chartink Signal Engine's
    confidence score and ATR sizing (see chartink_signal_service.py). A
    single global row -- the webhook has no per-user context, so this
    can't be a per-user setting the way RiskConfig is.

    The five score components (rsi/adx/volume/macd/trend) are meant to sum
    to 1.0 at their respective maximums, matching confidence's 0.0-1.0
    range, but that isn't enforced here -- an admin retuning them is
    trusted to keep it sane."""

    # RSI zone (0.0-1.0 fraction of candidates)
    rsi_healthy_min: float = 45.0
    rsi_healthy_max: float = 70.0
    rsi_healthy_score: float = 0.30
    rsi_moderate_score: float = 0.15
    rsi_extended_score: float = 0.05

    # ADX trend strength
    adx_strong_threshold: float = 25.0
    adx_strong_score: float = 0.25
    adx_rising_threshold: float = 20.0
    adx_rising_score: float = 0.15
    adx_weak_score: float = 0.05

    # Volume vs. 20-day average
    vol_strong_threshold: float = 2.0
    vol_strong_score: float = 0.25
    vol_moderate_threshold: float = 1.5
    vol_moderate_score: float = 0.15
    vol_mild_threshold: float = 1.0
    vol_mild_score: float = 0.08
    vol_weak_score: float = 0.03

    # MACD bullish crossover / SMA20>SMA50 uptrend
    macd_bullish_score: float = 0.15
    trend_score: float = 0.05

    # ATR-14 entry/stop-loss/target sizing
    atr_min_pct: float = 1.0
    atr_max_pct: float = 5.0
    atr_target_multiplier: float = 1.5
