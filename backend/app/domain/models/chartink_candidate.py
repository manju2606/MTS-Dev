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
    id: UUID = field(default_factory=uuid4)
    received_at: datetime = field(default_factory=datetime.utcnow)
