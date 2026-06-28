import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.domain.models.trade import Trade, TradeMode, TradeSignal, TradeStatus
from app.domain.models.user import User, UserRole
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def to_domain(self) -> User:
        return User(
            id=self.id,
            email=self.email,
            hashed_password=self.hashed_password,
            full_name=self.full_name,
            role=UserRole(self.role),
            is_active=self.is_active,
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
    __table_args__ = (
        UniqueConstraint("watchlist_id", "symbol", name="uq_watchlist_item_symbol"),
    )

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
