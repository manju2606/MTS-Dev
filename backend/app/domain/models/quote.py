from dataclasses import dataclass


@dataclass
class Quote:
    symbol: str
    price: float
    change: float
    change_pct: float
    volume: int
    day_high: float
    day_low: float
    prev_close: float
    exchange: str  # "NSE" or "BSE"
