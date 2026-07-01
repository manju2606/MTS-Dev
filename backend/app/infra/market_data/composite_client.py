"""Composite market data client — priority chain with automatic fallback.

Sources tried in order (configurable via MARKET_DATA_PRIORITY env var):
  1. nse_india    — Official NSE India API  (most accurate, real-time)
  2. yahoo        — Yahoo Finance via yfinance (robust, 15-min delay)
  3. moneycontrol — MoneyControl widget API   (best-effort)
  4. google       — Google Finance unofficial  (best-effort)

The first source that returns a non-zero price wins.  Source health is
tracked per-symbol so transient failures don't permanently disable a source.
"""

import asyncio
import time
from dataclasses import dataclass, field

import structlog

from app.domain.interfaces.market_data import MarketDataClient
from app.domain.models.quote import Quote

log = structlog.get_logger()


@dataclass
class SourceHealth:
    name: str
    success: int = 0
    failure: int = 0
    last_success_at: float = 0.0
    last_failure_at: float = 0.0
    last_error: str = ""

    @property
    def is_healthy(self) -> bool:
        # Temporarily back-off for 2 minutes after 3+ consecutive failures
        if self.failure >= 3 and self.last_failure_at > self.last_success_at:
            return (time.monotonic() - self.last_failure_at) > 120
        return True

    def record_success(self) -> None:
        self.success += 1
        self.last_success_at = time.monotonic()

    def record_failure(self, error: str) -> None:
        self.failure += 1
        self.last_failure_at = time.monotonic()
        self.last_error = error[:200]


_HEALTH: dict[str, SourceHealth] = {}


def _get_health(name: str) -> SourceHealth:
    if name not in _HEALTH:
        _HEALTH[name] = SourceHealth(name=name)
    return _HEALTH[name]


def get_all_source_health() -> list[dict]:
    return [
        {
            "source":         h.name,
            "success":        h.success,
            "failure":        h.failure,
            "healthy":        h.is_healthy,
            "last_error":     h.last_error,
        }
        for h in _HEALTH.values()
    ]


def _build_priority(order: list[str]) -> list[tuple[str, MarketDataClient]]:
    from app.infra.market_data.yfinance_client     import YFinanceClient
    from app.infra.market_data.nse_india_client    import NseIndiaClient
    from app.infra.market_data.moneycontrol_client import MoneyControlClient
    from app.infra.market_data.google_finance_client import GoogleFinanceClient

    _MAP: dict[str, MarketDataClient] = {
        "nse_india":    NseIndiaClient(),
        "yahoo":        YFinanceClient(),
        "moneycontrol": MoneyControlClient(),
        "google":       GoogleFinanceClient(),
    }
    return [(name, _MAP[name]) for name in order if name in _MAP]


class CompositeMarketDataClient(MarketDataClient):
    """Tries each data source in priority order, returning the first valid quote."""

    def __init__(self, priority: list[str] | None = None) -> None:
        if priority is None:
            priority = ["nse_india", "yahoo", "moneycontrol", "google"]
        self._sources = _build_priority(priority)

    async def get_quote(self, symbol: str) -> Quote:
        last_exc: Exception = RuntimeError("No market data sources available")

        for name, client in self._sources:
            health = _get_health(name)
            if not health.is_healthy:
                log.debug("composite.source.skip", source=name, symbol=symbol)
                continue

            try:
                quote = await client.get_quote(symbol)
                if quote.price > 0:
                    health.record_success()
                    if name != self._sources[0][0]:
                        log.info("composite.fallback.used", source=name, symbol=symbol)
                    return quote
                raise ValueError("Returned zero price")
            except Exception as exc:
                health.record_failure(str(exc))
                last_exc = exc
                log.warning(
                    "composite.source.failed",
                    source=name, symbol=symbol, error=str(exc),
                )

        raise last_exc

    async def get_quotes(self, symbols: list[str]) -> list[Quote]:
        results = await asyncio.gather(
            *[self._safe_get(s) for s in symbols]
        )
        return [q for q in results if q is not None]

    async def _safe_get(self, symbol: str) -> Quote | None:
        try:
            return await self.get_quote(symbol)
        except Exception:
            return None

    async def get_quote_multi_source(self, symbol: str) -> dict:
        """Fetch from ALL sources concurrently and return a comparison dict."""
        async def _try(name: str, client: MarketDataClient) -> dict:
            try:
                q = await client.get_quote(symbol)
                return {
                    "source": name, "ok": True,
                    "price": q.price, "change_pct": q.change_pct,
                    "volume": q.volume, "exchange": q.exchange,
                }
            except Exception as exc:
                return {"source": name, "ok": False, "error": str(exc)[:100]}

        results = await asyncio.gather(*[_try(n, c) for n, c in self._sources])
        return {"symbol": symbol, "sources": list(results)}
