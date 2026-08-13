from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class ChartinkCandidate:
    """One symbol from a Chartink scan alert, scored by the Signal Engine.

    signal/confidence/entry_price/stop_loss/target/risk_reward_ratio/
    holding_period/explanation follow the AI recommendation schema mandated
    in CLAUDE.md. rsi/adx/volume_ratio are carried alongside purely for
    transparency in the alert email/dashboard, same as IntradayCandidate.

    batch_id groups every candidate saved from one process_chartink_alert()
    call (one webhook delivery, or one scan-link poll) -- received_at can't
    be used for that instead since each candidate gets its own via this
    dataclass's default_factory at object-creation time inside a loop, so
    two candidates from the same batch can differ by several milliseconds.
    Used by chartink_repo.compare_latest_batches() (new/persistent/dropped
    vs. the previous batch for the same scan_name).
    """

    scan_name: str
    symbol: str
    trigger_price: float
    signal: str  # "BUY" | "SELL" | "HOLD" -- fixed to "BUY" today, cash-equity-only
    confidence: float  # 0.0-1.0
    entry_price: float
    stop_loss: float
    target: float
    risk_reward_ratio: float
    holding_period: str
    explanation: str
    rsi: float
    adx: float
    volume_ratio: float
    batch_id: UUID | None = None
    id: UUID = field(default_factory=uuid4)
    received_at: datetime = field(default_factory=datetime.utcnow)
