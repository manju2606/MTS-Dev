"""Historical OHLCV candle for any NSE/BSE/NFO/MCX instrument, downloaded via
Zerodha (see infra/brokers/zerodha_enctoken.py). Shared market data, not
scoped to a user -- the same candle series is identical for everyone who
downloads it, so it's keyed on (symbol, exchange, interval, time) only.
"""

from dataclasses import dataclass
from datetime import datetime


@dataclass
class HistoricalCandle:
    symbol: str
    exchange: str  # NSE | BSE | NFO | MCX
    interval: str  # minute | 3minute | 5minute | 10minute | 15minute | 30minute | 60minute | day
    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int
    open_interest: int | None = None
    saved_at: datetime | None = None
