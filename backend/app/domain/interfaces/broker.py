from abc import ABC, abstractmethod

from app.domain.models.order import LiveOrder


class AbstractBroker(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def is_connected(self) -> bool: ...

    @property
    def credentials(self) -> dict[str, str]:
        """Whatever this broker needs to reconstruct an equivalent session
        later (access token, client id, etc.) -- used by session_store to
        persist the session past this process's lifetime. Brokers with
        nothing worth persisting (e.g. the simulated broker) can leave this
        as the default empty dict; session_store treats that as "don't
        bother persisting me"."""
        return {}

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
