from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class ChartinkBreakoutAlert:
    """Fired once a symbol has appeared in 3 consecutive scan batches for
    the same scan_name (webhook or scan-link poll -- either source, same
    chartink_candidates table) -- see
    chartink_repo.detect_new_breakouts(). Scored once at breakout time
    with the same AI engine regular Chartink candidates use (see
    chartink_signal_service._record_and_alert_breakouts()), so this
    carries a real confidence/entry/stop_loss/target/risk_reward_ratio
    the same way any other AI recommendation in this app does -- not
    just the bare "appeared 3x" fact the original version stored.

    `status`/`exit_price`/`closed_at` track resolution against that
    entry/stop_loss/target, same WIN/LOSS/EXPIRED pattern as
    mcx_signal_service.resolve_open_signals -- see
    chartink_signal_service.resolve_breakout_alerts(). LTP/change/day-
    week-month P&L are NOT stored here; those stay computed live on
    every read of GET /chartink/breakouts (see get_breakout_watchlist()),
    the same "don't store what goes stale" choice
    portfolio_ohlc_service.py makes for its own change/P&L figures --
    only the entry/exit levels needed to resolve win/loss are persisted.
    """

    scan_name: str
    symbol: str
    appeared_date: str  # "YYYY-MM-DD", IST, the date the streak reached 3
    streak_count: int  # consecutive-batch count at alert time (always 3 -- see detection logic)
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)

    # AI analysis at breakout time -- same schema every AI recommendation
    # in this app fills (see CLAUDE.md), signal is implicitly "BUY"
    # (cash-equity-only, same as the rest of Chartink). None only if the
    # scorer itself failed (e.g. a delisted symbol) -- the alert still
    # gets recorded/emailed either way.
    confidence: float | None = None
    entry_price: float | None = None
    stop_loss: float | None = None
    target: float | None = None
    risk_reward_ratio: float | None = None
    rsi: float | None = None
    adx: float | None = None
    volume_ratio: float | None = None
    volume: float | None = None  # raw latest-session share volume
    market_cap: float | None = None  # yfinance fast_info.market_cap at breakout time
    explanation: str | None = None

    # Resolution against entry_price/stop_loss/target.
    status: str = "OPEN"  # OPEN | WIN | LOSS | EXPIRED
    exit_price: float | None = None
    closed_at: datetime | None = None
