from abc import ABC, abstractmethod

from app.domain.models.order import LiveOrder


class AbstractBroker(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def is_connected(self) -> bool: ...

    @abstractmethod
    async def place_order(
        self,
        user_id: str,
        symbol: str,
        exchange: str,
        signal: str,
        quantity: int,
        order_type: str = "MARKET",
        price: float | None = None,
    ) -> LiveOrder: ...

    @abstractmethod
    async def cancel_order(self, broker_order_id: str) -> bool: ...

    @abstractmethod
    async def get_order(self, broker_order_id: str) -> LiveOrder | None: ...

    @abstractmethod
    async def get_positions(self) -> list[dict]: ...
