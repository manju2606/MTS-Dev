from abc import ABC, abstractmethod

from app.domain.models.quote import Quote


class MarketDataClient(ABC):
    @abstractmethod
    async def get_quote(self, symbol: str) -> Quote: ...

    @abstractmethod
    async def get_quotes(self, symbols: list[str]) -> list[Quote]: ...
