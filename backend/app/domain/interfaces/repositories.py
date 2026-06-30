from abc import ABC, abstractmethod
from uuid import UUID

from app.domain.models.ai_signal import AISignal
from app.domain.models.alert import Alert
from app.domain.models.trade import Trade, TradeStatus
from app.domain.models.user import User
from app.domain.models.watchlist import Watchlist, WatchlistItem


class UserRepository(ABC):
    @abstractmethod
    async def get_by_id(self, user_id: UUID) -> User | None: ...

    @abstractmethod
    async def get_by_email(self, email: str) -> User | None: ...

    @abstractmethod
    async def create(self, user: User) -> User: ...

    @abstractmethod
    async def update(self, user: User) -> User: ...


class TradeRepository(ABC):
    @abstractmethod
    async def get_by_id(self, trade_id: UUID) -> Trade | None: ...

    @abstractmethod
    async def list_by_user(
        self, user_id: UUID, status: TradeStatus | None = None
    ) -> list[Trade]: ...

    @abstractmethod
    async def create(self, trade: Trade) -> Trade: ...

    @abstractmethod
    async def update(self, trade: Trade) -> Trade: ...


class AISignalRepository(ABC):
    @abstractmethod
    async def save(self, signal: AISignal) -> AISignal: ...

    @abstractmethod
    async def list_by_user(
        self, user_id: UUID, symbol: str | None = None, limit: int = 50
    ) -> list[AISignal]: ...


class WatchlistRepository(ABC):
    # ── Watchlist management ──────────────────────────────────────────────
    @abstractmethod
    async def create_watchlist(self, user_id: UUID, name: str) -> Watchlist: ...

    @abstractmethod
    async def list_watchlists(self, user_id: UUID) -> list[Watchlist]: ...

    @abstractmethod
    async def get_watchlist(self, watchlist_id: UUID, user_id: UUID) -> Watchlist | None: ...

    @abstractmethod
    async def rename_watchlist(self, watchlist_id: UUID, user_id: UUID, name: str) -> Watchlist: ...

    @abstractmethod
    async def delete_watchlist(self, watchlist_id: UUID, user_id: UUID) -> bool: ...

    # ── Item management (watchlist-scoped) ────────────────────────────────
    @abstractmethod
    async def list_items(self, watchlist_id: UUID, user_id: UUID) -> list[WatchlistItem]: ...

    @abstractmethod
    async def add_item(self, item: WatchlistItem) -> WatchlistItem: ...

    @abstractmethod
    async def remove_item(self, watchlist_id: UUID, user_id: UUID, symbol: str) -> bool: ...

    @abstractmethod
    async def move_item(self, item_id: UUID, to_watchlist_id: UUID, user_id: UUID) -> bool: ...

    # ── Legacy / backward-compat (user-scoped, no watchlist filter) ───────
    @abstractmethod
    async def list_by_user(self, user_id: UUID) -> list[WatchlistItem]: ...

    @abstractmethod
    async def get(self, user_id: UUID, symbol: str) -> WatchlistItem | None: ...

    @abstractmethod
    async def add(self, item: WatchlistItem) -> WatchlistItem: ...

    @abstractmethod
    async def remove(self, user_id: UUID, symbol: str) -> bool: ...


class AlertRepository(ABC):
    @abstractmethod
    async def list_by_user(self, user_id: UUID) -> list[Alert]: ...

    @abstractmethod
    async def create(self, alert: Alert) -> Alert: ...

    @abstractmethod
    async def get_by_id(self, alert_id: UUID) -> Alert | None: ...

    @abstractmethod
    async def update(self, alert: Alert) -> Alert: ...

    @abstractmethod
    async def delete(self, alert_id: UUID, user_id: UUID) -> bool: ...

    @abstractmethod
    async def list_untriggered(self) -> list[Alert]: ...
