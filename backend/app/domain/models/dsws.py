"""DSWS — Daily Discovery Watchlist Summary.

Buckets the Discovery Engine's current picks by signal strength every morning,
tracks each pick's price every 30 minutes through market close, and reports
which bucket / stock performed best over a day, week, or month.
"""

from dataclasses import dataclass, field
from datetime import datetime

DSWS_BUCKETS = ("STRONG_BUY", "BUY", "SELL", "STRONG_SELL")


@dataclass
class DswsCheckpoint:
    time: str  # "10:00", "10:30", ...
    price: float
    pct_change: float  # vs entry_price
    captured_at: datetime


@dataclass
class DswsPick:
    symbol: str
    name: str
    signal: str  # STRONG_BUY | BUY | SELL | STRONG_SELL
    score: float
    entry_price: float
    stop_loss: float
    target: float
    added_at: datetime
    checkpoints: list[DswsCheckpoint] = field(default_factory=list)
    close_price: float | None = None
    close_pct: float | None = None


@dataclass
class DswsScan:
    scan_date: str
    generated_at: datetime
    buckets: dict[str, list[DswsPick]] = field(
        default_factory=lambda: {b: [] for b in DSWS_BUCKETS}
    )
    closed_out: bool = False
