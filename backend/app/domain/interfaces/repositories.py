from abc import ABC, abstractmethod
from uuid import UUID

from app.domain.models.trade import Trade, TradeStatus
from app.domain.models.user import User


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
