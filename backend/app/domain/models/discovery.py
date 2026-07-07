from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class NewsItem:
    title: str
    source: str
    url: str
    published_at: datetime
    sentiment_score: float  # -1.0 to +1.0
    mentioned_symbols: list[str]
    summary: str = ""
    id: UUID = field(default_factory=uuid4)
    fetched_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class SocialSignal:
    source: str  # "reddit" | "twitter" | "youtube" | "telegram" | "google_trends"
    symbol: str
    score: float  # -1.0 to +1.0
    mention_volume: int
    is_stub: bool = True


@dataclass
class StockScore:
    symbol: str
    name: str
    score: float  # 0–100 composite
    signal: str  # STRONG_BUY | BUY | WATCH | NEUTRAL | SELL | STRONG_SELL
    confidence: float  # 0–1
    entry_price: float
    stop_loss: float
    targets: list[float]  # [T1, T2, T3]
    holding_period: str
    risk_reward_ratio: float
    technical_score: float  # 0–100
    news_score: float  # 0–100
    ml_score: float  # 0–100
    social_score: float  # 0–100 (stub)
    patterns: list[str]  # breakout pattern labels
    news_summary: str
    explanation: str
    scanned_at: datetime
    id: UUID = field(default_factory=uuid4)


@dataclass
class DiscoveryStatus:
    last_scan_at: datetime | None
    next_scan_at: datetime | None
    stocks_scanned: int
    is_running: bool
    scheduler_active: bool
