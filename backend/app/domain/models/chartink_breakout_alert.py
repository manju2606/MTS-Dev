from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class ChartinkBreakoutAlert:
    """Fired once a symbol has appeared in 3 consecutive scan batches for
    the same scan_name (webhook or scan-link poll -- either source, same
    chartink_candidates table) -- see
    chartink_repo.check_and_record_breakouts(). Only the event facts are
    stored here (when, which symbol, how long the streak was at alert
    time); LTP/change/day-week-month P&L are computed live each time the
    breakout list is read (see api/v1/chartink.py's GET /breakouts),
    the same "don't store what goes stale" choice
    portfolio_ohlc_service.py makes for its own change/P&L figures.
    """

    scan_name: str
    symbol: str
    appeared_date: str  # "YYYY-MM-DD", IST, the date the streak reached 3
    streak_count: int  # consecutive-batch count at alert time (always 3 -- see detection logic)
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
