import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.domain.models.ai_signal import AISignal
from app.domain.models.alert import Alert
from app.domain.models.api_key import ApiKey
from app.domain.models.chartink_breakout_alert import ChartinkBreakoutAlert
from app.domain.models.chartink_candidate import ChartinkCandidate
from app.domain.models.chartink_poll_run import ChartinkPollRun
from app.domain.models.chartink_scan_link import ChartinkScanLink
from app.domain.models.chartink_scoring_config import ChartinkScoringConfig
from app.domain.models.trade import Trade, TradeMode, TradeSignal, TradeStatus
from app.domain.models.user import SubscriptionTier, User, UserRole
from app.domain.models.watchlist import Watchlist, WatchlistItem


class Base(DeclarativeBase):
    pass


class UserORM(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default=UserRole.TRADER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    subscription_tier: Mapped[str] = mapped_column(String(20), nullable=False, default="free")
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def to_domain(self) -> User:
        return User(
            id=self.id,
            email=self.email,
            hashed_password=self.hashed_password,
            full_name=self.full_name,
            role=UserRole(self.role),
            is_active=self.is_active,
            subscription_tier=SubscriptionTier(self.subscription_tier),
            email_verified=self.email_verified,
            created_at=self.created_at,
        )

    @classmethod
    def from_domain(cls, user: User) -> "UserORM":
        return cls(
            id=user.id,
            email=user.email,
            hashed_password=user.hashed_password,
            full_name=user.full_name,
            role=user.role.value,
            is_active=user.is_active,
            subscription_tier=user.subscription_tier.value,
            email_verified=user.email_verified,
            created_at=user.created_at,
        )


class WatchlistORM(Base):
    __tablename__ = "watchlists"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_watchlist_user_name"),)

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def to_domain(self) -> Watchlist:
        return Watchlist(
            id=self.id, user_id=self.user_id, name=self.name, created_at=self.created_at
        )

    @classmethod
    def from_domain(cls, wl: Watchlist) -> "WatchlistORM":
        return cls(id=wl.id, user_id=wl.user_id, name=wl.name, created_at=wl.created_at)


class WatchlistItemORM(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (UniqueConstraint("watchlist_id", "symbol", name="uq_watchlist_item_symbol"),)

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    watchlist_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("watchlists.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    symbol: Mapped[str] = mapped_column(String(50), nullable=False)
    exchange: Mapped[str] = mapped_column(String(10), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def to_domain(self) -> WatchlistItem:
        return WatchlistItem(
            id=self.id,
            user_id=self.user_id,
            watchlist_id=self.watchlist_id,
            symbol=self.symbol,
            exchange=self.exchange,
            added_at=self.added_at,
        )

    @classmethod
    def from_domain(cls, item: WatchlistItem) -> "WatchlistItemORM":
        return cls(
            id=item.id,
            user_id=item.user_id,
            watchlist_id=item.watchlist_id,
            symbol=item.symbol,
            exchange=item.exchange,
            added_at=item.added_at,
        )


class TradeORM(Base):
    __tablename__ = "trades"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    symbol: Mapped[str] = mapped_column(String(50), nullable=False)
    exchange: Mapped[str] = mapped_column(String(10), nullable=False)
    signal: Mapped[str] = mapped_column(String(10), nullable=False)
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    stop_loss: Mapped[float] = mapped_column(Float, nullable=False)
    target: Mapped[float] = mapped_column(Float, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    mode: Mapped[str] = mapped_column(String(10), nullable=False, default=TradeMode.PAPER)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=TradeStatus.OPEN)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    exit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def to_domain(self) -> Trade:
        return Trade(
            id=self.id,
            user_id=self.user_id,
            symbol=self.symbol,
            exchange=self.exchange,
            signal=TradeSignal(self.signal),
            entry_price=self.entry_price,
            stop_loss=self.stop_loss,
            target=self.target,
            quantity=self.quantity,
            mode=TradeMode(self.mode),
            status=TradeStatus(self.status),
            opened_at=self.opened_at,
            closed_at=self.closed_at,
            exit_price=self.exit_price,
            ai_confidence=self.ai_confidence,
            ai_explanation=self.ai_explanation,
            created_at=self.created_at,
        )

    @classmethod
    def from_domain(cls, trade: Trade) -> "TradeORM":
        return cls(
            id=trade.id,
            user_id=trade.user_id,
            symbol=trade.symbol,
            exchange=trade.exchange,
            signal=trade.signal.value,
            entry_price=trade.entry_price,
            stop_loss=trade.stop_loss,
            target=trade.target,
            quantity=trade.quantity,
            mode=trade.mode.value,
            status=trade.status.value,
            opened_at=trade.opened_at,
            closed_at=trade.closed_at,
            exit_price=trade.exit_price,
            ai_confidence=trade.ai_confidence,
            ai_explanation=trade.ai_explanation,
            created_at=trade.created_at,
        )


class AISignalORM(Base):
    __tablename__ = "ai_signals"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    symbol: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    signal: Mapped[str] = mapped_column(String(10), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    stop_loss: Mapped[float] = mapped_column(Float, nullable=False)
    target: Mapped[float] = mapped_column(Float, nullable=False)
    risk_reward_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    holding_period: Mapped[str] = mapped_column(String(50), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    engine: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    def to_domain(self) -> AISignal:
        return AISignal(
            id=self.id,
            user_id=self.user_id,
            symbol=self.symbol,
            signal=self.signal,
            confidence=self.confidence,
            entry_price=self.entry_price,
            stop_loss=self.stop_loss,
            target=self.target,
            risk_reward_ratio=self.risk_reward_ratio,
            holding_period=self.holding_period,
            explanation=self.explanation,
            engine=self.engine,
            created_at=self.created_at,
        )

    @classmethod
    def from_domain(cls, s: AISignal) -> "AISignalORM":
        return cls(
            id=s.id,
            user_id=s.user_id,
            symbol=s.symbol,
            signal=s.signal,
            confidence=s.confidence,
            entry_price=s.entry_price,
            stop_loss=s.stop_loss,
            target=s.target,
            risk_reward_ratio=s.risk_reward_ratio,
            holding_period=s.holding_period,
            explanation=s.explanation,
            engine=s.engine,
            created_at=s.created_at,
        )


class ApiKeyORM(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    key_prefix: Mapped[str] = mapped_column(String(12), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)

    def to_domain(self) -> ApiKey:
        return ApiKey(
            id=self.id,
            user_id=self.user_id,
            name=self.name,
            key_hash=self.key_hash,
            key_prefix=self.key_prefix,
            created_at=self.created_at,
            last_used_at=self.last_used_at,
            revoked=self.revoked,
        )

    @classmethod
    def from_domain(cls, key: ApiKey) -> "ApiKeyORM":
        return cls(
            id=key.id,
            user_id=key.user_id,
            name=key.name,
            key_hash=key.key_hash,
            key_prefix=key.key_prefix,
            created_at=key.created_at,
            last_used_at=key.last_used_at,
            revoked=key.revoked,
        )


class ZerodhaAutoLoginCredentialORM(Base):
    """Stores one row per user who's opted into unattended Zerodha
    auto-login. `encrypted_payload` is a Fernet-encrypted JSON blob of
    {kite_user_id, password, totp_secret} -- see app/core/crypto.py.
    Encryption/decryption happens in the repository layer (like
    SQLApiKeyRepository hashes, not this ORM class), so this class never
    sees plaintext credentials."""

    __tablename__ = "zerodha_auto_login_credentials"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    encrypted_payload: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    last_auto_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_auto_login_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)


class AlertORM(Base):
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    symbol: Mapped[str] = mapped_column(String(50), nullable=False)
    price_target: Mapped[float] = mapped_column(Float, nullable=False)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)  # "above" | "below"
    triggered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    triggered_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def to_domain(self) -> Alert:
        return Alert(
            id=self.id,
            user_id=self.user_id,
            symbol=self.symbol,
            price_target=self.price_target,
            direction=self.direction,
            triggered=self.triggered,
            triggered_at=self.triggered_at,
            triggered_price=self.triggered_price,
            created_at=self.created_at,
        )

    @classmethod
    def from_domain(cls, a: Alert) -> "AlertORM":
        return cls(
            id=a.id,
            user_id=a.user_id,
            symbol=a.symbol,
            price_target=a.price_target,
            direction=a.direction,
            triggered=a.triggered,
            triggered_at=a.triggered_at,
            triggered_price=a.triggered_price,
            created_at=a.created_at,
        )


class ChartinkCandidateORM(Base):
    __tablename__ = "chartink_candidates"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    scan_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    trigger_price: Mapped[float] = mapped_column(Float, nullable=False)
    signal: Mapped[str] = mapped_column(String(10), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    stop_loss: Mapped[float] = mapped_column(Float, nullable=False)
    target: Mapped[float] = mapped_column(Float, nullable=False)
    risk_reward_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    holding_period: Mapped[str] = mapped_column(String(50), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    rsi: Mapped[float] = mapped_column(Float, nullable=False)
    adx: Mapped[float] = mapped_column(Float, nullable=False)
    volume_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True, index=True
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, index=True
    )

    def to_domain(self) -> ChartinkCandidate:
        return ChartinkCandidate(
            id=self.id,
            scan_name=self.scan_name,
            symbol=self.symbol,
            trigger_price=self.trigger_price,
            signal=self.signal,
            confidence=self.confidence,
            entry_price=self.entry_price,
            stop_loss=self.stop_loss,
            target=self.target,
            risk_reward_ratio=self.risk_reward_ratio,
            holding_period=self.holding_period,
            explanation=self.explanation,
            rsi=self.rsi,
            adx=self.adx,
            volume_ratio=self.volume_ratio,
            batch_id=self.batch_id,
            received_at=self.received_at,
        )

    @classmethod
    def from_domain(cls, c: ChartinkCandidate) -> "ChartinkCandidateORM":
        return cls(
            id=c.id,
            scan_name=c.scan_name,
            symbol=c.symbol,
            trigger_price=c.trigger_price,
            signal=c.signal,
            confidence=c.confidence,
            entry_price=c.entry_price,
            stop_loss=c.stop_loss,
            target=c.target,
            risk_reward_ratio=c.risk_reward_ratio,
            holding_period=c.holding_period,
            explanation=c.explanation,
            rsi=c.rsi,
            adx=c.adx,
            volume_ratio=c.volume_ratio,
            batch_id=c.batch_id,
            received_at=c.received_at,
        )


class ChartinkScoringConfigORM(Base):
    """Single global row (id fixed to 1) -- see ChartinkScoringConfig."""

    __tablename__ = "chartink_scoring_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    rsi_healthy_min: Mapped[float] = mapped_column(Float, nullable=False)
    rsi_healthy_max: Mapped[float] = mapped_column(Float, nullable=False)
    rsi_healthy_score: Mapped[float] = mapped_column(Float, nullable=False)
    rsi_moderate_score: Mapped[float] = mapped_column(Float, nullable=False)
    rsi_extended_score: Mapped[float] = mapped_column(Float, nullable=False)
    adx_strong_threshold: Mapped[float] = mapped_column(Float, nullable=False)
    adx_strong_score: Mapped[float] = mapped_column(Float, nullable=False)
    adx_rising_threshold: Mapped[float] = mapped_column(Float, nullable=False)
    adx_rising_score: Mapped[float] = mapped_column(Float, nullable=False)
    adx_weak_score: Mapped[float] = mapped_column(Float, nullable=False)
    vol_strong_threshold: Mapped[float] = mapped_column(Float, nullable=False)
    vol_strong_score: Mapped[float] = mapped_column(Float, nullable=False)
    vol_moderate_threshold: Mapped[float] = mapped_column(Float, nullable=False)
    vol_moderate_score: Mapped[float] = mapped_column(Float, nullable=False)
    vol_mild_threshold: Mapped[float] = mapped_column(Float, nullable=False)
    vol_mild_score: Mapped[float] = mapped_column(Float, nullable=False)
    vol_weak_score: Mapped[float] = mapped_column(Float, nullable=False)
    macd_bullish_score: Mapped[float] = mapped_column(Float, nullable=False)
    trend_score: Mapped[float] = mapped_column(Float, nullable=False)
    atr_min_pct: Mapped[float] = mapped_column(Float, nullable=False)
    atr_max_pct: Mapped[float] = mapped_column(Float, nullable=False)
    atr_target_multiplier: Mapped[float] = mapped_column(Float, nullable=False)

    def to_domain(self) -> ChartinkScoringConfig:
        return ChartinkScoringConfig(
            rsi_healthy_min=self.rsi_healthy_min,
            rsi_healthy_max=self.rsi_healthy_max,
            rsi_healthy_score=self.rsi_healthy_score,
            rsi_moderate_score=self.rsi_moderate_score,
            rsi_extended_score=self.rsi_extended_score,
            adx_strong_threshold=self.adx_strong_threshold,
            adx_strong_score=self.adx_strong_score,
            adx_rising_threshold=self.adx_rising_threshold,
            adx_rising_score=self.adx_rising_score,
            adx_weak_score=self.adx_weak_score,
            vol_strong_threshold=self.vol_strong_threshold,
            vol_strong_score=self.vol_strong_score,
            vol_moderate_threshold=self.vol_moderate_threshold,
            vol_moderate_score=self.vol_moderate_score,
            vol_mild_threshold=self.vol_mild_threshold,
            vol_mild_score=self.vol_mild_score,
            vol_weak_score=self.vol_weak_score,
            macd_bullish_score=self.macd_bullish_score,
            trend_score=self.trend_score,
            atr_min_pct=self.atr_min_pct,
            atr_max_pct=self.atr_max_pct,
            atr_target_multiplier=self.atr_target_multiplier,
        )

    @classmethod
    def from_domain(cls, c: ChartinkScoringConfig) -> "ChartinkScoringConfigORM":
        return cls(
            id=1,
            rsi_healthy_min=c.rsi_healthy_min,
            rsi_healthy_max=c.rsi_healthy_max,
            rsi_healthy_score=c.rsi_healthy_score,
            rsi_moderate_score=c.rsi_moderate_score,
            rsi_extended_score=c.rsi_extended_score,
            adx_strong_threshold=c.adx_strong_threshold,
            adx_strong_score=c.adx_strong_score,
            adx_rising_threshold=c.adx_rising_threshold,
            adx_rising_score=c.adx_rising_score,
            adx_weak_score=c.adx_weak_score,
            vol_strong_threshold=c.vol_strong_threshold,
            vol_strong_score=c.vol_strong_score,
            vol_moderate_threshold=c.vol_moderate_threshold,
            vol_moderate_score=c.vol_moderate_score,
            vol_mild_threshold=c.vol_mild_threshold,
            vol_mild_score=c.vol_mild_score,
            vol_weak_score=c.vol_weak_score,
            macd_bullish_score=c.macd_bullish_score,
            trend_score=c.trend_score,
            atr_min_pct=c.atr_min_pct,
            atr_max_pct=c.atr_max_pct,
            atr_target_multiplier=c.atr_target_multiplier,
        )


class ChartinkScanLinkORM(Base):
    __tablename__ = "chartink_scan_links"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    scan_name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    poll_interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    scan_clause: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_poll_status: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_poll_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def to_domain(self) -> ChartinkScanLink:
        return ChartinkScanLink(
            id=self.id,
            scan_name=self.scan_name,
            url=self.url,
            poll_interval_minutes=self.poll_interval_minutes,
            enabled=self.enabled,
            scan_clause=self.scan_clause,
            last_polled_at=self.last_polled_at,
            last_poll_status=self.last_poll_status,
            last_poll_count=self.last_poll_count,
            created_at=self.created_at,
        )

    @classmethod
    def from_domain(cls, s: ChartinkScanLink) -> "ChartinkScanLinkORM":
        return cls(
            id=s.id,
            scan_name=s.scan_name,
            url=s.url,
            poll_interval_minutes=s.poll_interval_minutes,
            enabled=s.enabled,
            scan_clause=s.scan_clause,
            last_polled_at=s.last_polled_at,
            last_poll_status=s.last_poll_status,
            last_poll_count=s.last_poll_count,
            created_at=s.created_at,
        )


class ChartinkBreakoutAlertORM(Base):
    __tablename__ = "chartink_breakout_alerts"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    scan_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    appeared_date: Mapped[str] = mapped_column(String(10), nullable=False)
    streak_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    entry_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    target: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_reward_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    rsi: Mapped[float | None] = mapped_column(Float, nullable=True)
    adx: Mapped[float | None] = mapped_column(Float, nullable=True)
    volume_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    market_cap: Mapped[float | None] = mapped_column(Float, nullable=True)
    beta: Mapped[float | None] = mapped_column(Float, nullable=True)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(10), nullable=False, default="OPEN", index=True)
    exit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    def to_domain(self) -> ChartinkBreakoutAlert:
        return ChartinkBreakoutAlert(
            id=self.id,
            scan_name=self.scan_name,
            symbol=self.symbol,
            appeared_date=self.appeared_date,
            streak_count=self.streak_count,
            created_at=self.created_at,
            confidence=self.confidence,
            entry_price=self.entry_price,
            stop_loss=self.stop_loss,
            target=self.target,
            risk_reward_ratio=self.risk_reward_ratio,
            rsi=self.rsi,
            adx=self.adx,
            volume_ratio=self.volume_ratio,
            volume=self.volume,
            market_cap=self.market_cap,
            beta=self.beta,
            explanation=self.explanation,
            status=self.status,
            exit_price=self.exit_price,
            closed_at=self.closed_at,
        )

    @classmethod
    def from_domain(cls, a: ChartinkBreakoutAlert) -> "ChartinkBreakoutAlertORM":
        return cls(
            id=a.id,
            scan_name=a.scan_name,
            symbol=a.symbol,
            appeared_date=a.appeared_date,
            streak_count=a.streak_count,
            created_at=a.created_at,
            confidence=a.confidence,
            entry_price=a.entry_price,
            stop_loss=a.stop_loss,
            target=a.target,
            risk_reward_ratio=a.risk_reward_ratio,
            rsi=a.rsi,
            adx=a.adx,
            volume_ratio=a.volume_ratio,
            volume=a.volume,
            market_cap=a.market_cap,
            beta=a.beta,
            explanation=a.explanation,
            status=a.status,
            exit_price=a.exit_price,
            closed_at=a.closed_at,
        )


class ChartinkPollRunORM(Base):
    __tablename__ = "chartink_poll_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    scan_link_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("chartink_scan_links.id"), nullable=False, index=True
    )
    scan_name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(500), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    polled_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    def to_domain(self) -> ChartinkPollRun:
        return ChartinkPollRun(
            id=self.id,
            scan_link_id=self.scan_link_id,
            scan_name=self.scan_name,
            status=self.status,
            count=self.count,
            polled_at=self.polled_at,
        )

    @classmethod
    def from_domain(cls, r: ChartinkPollRun) -> "ChartinkPollRunORM":
        return cls(
            id=r.id,
            scan_link_id=r.scan_link_id,
            scan_name=r.scan_name,
            status=r.status,
            count=r.count,
            polled_at=r.polled_at,
        )
