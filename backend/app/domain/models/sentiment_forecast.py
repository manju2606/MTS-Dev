"""Weekly market-sentiment forecast: a transparent, rule-based projection of
NSE market breadth (% bullish/bearish/watch among scanned stocks) for each
weekday, tracked against what actually happened once each day closes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class SentimentSnapshot:
    """Actual end-of-day market sentiment, computed from that day's Discovery scan."""

    date: str  # YYYY-MM-DD
    bullish_count: int
    bearish_count: int
    watch_count: int
    total_count: int
    bull_pct: float
    bear_pct: float
    label: str  # Bullish | Cautiously Bullish | Neutral | Cautious | Bearish
    vix: float | None = None
    nifty_close: float | None = None
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class ForecastDay:
    date: str  # YYYY-MM-DD
    weekday: str  # Monday..Friday
    forecast_bull_pct: float
    forecast_label: str
    actual_bull_pct: float | None = None
    actual_label: str | None = None
    label_match: bool | None = None
    error_pct: float | None = None
    resolved_at: str | None = None


@dataclass
class WeeklySentimentForecast:
    week_start: str  # YYYY-MM-DD (Monday)
    generated_at: datetime
    inputs: dict  # avg_bull_pct_3d, vix_value, vix_change_pct, nifty_momentum_pct
    days: list[ForecastDay]
    id: UUID = field(default_factory=uuid4)
