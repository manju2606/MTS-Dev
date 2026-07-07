"""Google Finance client — uses the unofficial JSON endpoint.

Google Finance does not offer a public API.  This client uses the
older `finance.google.com/finance/info` endpoint that returns JSONP;
it is treated as best-effort (may return stale data or fail if Google
changes the endpoint).  Always used as a tertiary fallback only.
"""

import asyncio
import json
import math
import re

import httpx
import structlog

from app.domain.interfaces.market_data import MarketDataClient
from app.domain.models.quote import Quote

log = structlog.get_logger()

_JSONP_PREFIX = re.compile(r"^//\s*")

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# exchange tag that Google Finance expects
_EXCHANGE_TAG: dict[str, str] = {
    ".NS": "NSE",
    ".BO": "BOM",
}


def _safe_float(v: object, default: float = 0.0) -> float:
    if v is None:
        return default
    s = str(v).replace(",", "")
    try:
        f = float(s)
        return default if math.isnan(f) else f
    except (ValueError, TypeError):
        return default


def _to_google_ticker(symbol: str) -> tuple[str, str]:
    """Return (exchange_tag, clean_ticker) for a Google Finance URL."""
    upper = symbol.upper()
    if upper.endswith(".NS"):
        return "NSE", upper[:-3]
    if upper.endswith(".BO"):
        return "BOM", upper[:-3]
    return "NSE", upper


async def _fetch_via_info_endpoint(exchange: str, ticker: str) -> dict:
    """Try the old finance.google.com/finance/info JSONP endpoint."""
    url = "https://finance.google.com/finance/info"
    params = {"client": "ig", "q": f"{exchange}:{ticker}"}
    async with httpx.AsyncClient(headers=_HEADERS, timeout=10.0, follow_redirects=True) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        body = _JSONP_PREFIX.sub("", resp.text).strip()
        data = json.loads(body)
        return data[0] if isinstance(data, list) and data else data


async def _fetch_via_quote_page(exchange: str, ticker: str) -> dict:
    """Scrape structured data from finance.google.com/finance/quote page."""
    url = f"https://www.google.com/finance/quote/{ticker}:{exchange}"
    async with httpx.AsyncClient(headers=_HEADERS, timeout=10.0, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        html = resp.text

    # Google embeds a c-wiz data attribute with JSON in the page
    # Pattern: data-last-price="2847.5"
    price_match = re.search(r'data-last-price="([0-9.,]+)"', html)
    change_match = re.search(r'data-last-normal-market-change="(-?[0-9.,]+)"', html)
    pct_match = re.search(r'data-last-normal-market-change-percent="(-?[0-9.,]+)"', html)

    if not price_match:
        # Try alternative pattern (div text with currency symbol)
        price_match = re.search(r'class="YMlKec[^"]*">(?:₹|Rs\.?)\s*([0-9,]+\.?\d*)', html)

    if not price_match:
        raise ValueError("Price not found in Google Finance page")

    price = _safe_float(price_match.group(1).replace(",", ""))
    change = _safe_float(change_match.group(1)) if change_match else 0.0
    pct = _safe_float(pct_match.group(1)) if pct_match else 0.0

    return {"l": price, "c": change, "cp": pct}


async def _google_fetch(symbol: str) -> Quote:
    exchange, ticker = _to_google_ticker(symbol)

    # Try endpoint 1 (fast, JSONP)
    try:
        data = await _fetch_via_info_endpoint(exchange, ticker)
        price = _safe_float(data.get("l") or data.get("price"))
        if price == 0:
            raise ValueError("zero price from info endpoint")
        prev = _safe_float(data.get("pcls_fix") or data.get("prev_close"), price)
        change = _safe_float(data.get("c"), price - prev)
        pct = _safe_float(data.get("cp"), change / prev * 100 if prev else 0)
        vol = int(_safe_float(data.get("vo") or data.get("volume"), 0))
        high = _safe_float(data.get("hi") or data.get("day_high"), price)
        low = _safe_float(data.get("lo") or data.get("day_low"), price)
    except Exception as e1:
        log.debug("google_finance.info_endpoint.failed", ticker=ticker, error=str(e1))
        # Fallback to page scrape
        data2 = await _fetch_via_quote_page(exchange, ticker)
        price = _safe_float(data2.get("l"), 0)
        prev = price - _safe_float(data2.get("c"), 0)
        change = _safe_float(data2.get("c"), 0)
        pct = _safe_float(data2.get("cp"), 0)
        vol = high = low = 0.0

    if price == 0:
        raise ValueError(f"Google Finance returned no price for '{symbol}'")

    return Quote(
        symbol=symbol.upper() if symbol.upper().endswith((".NS", ".BO")) else f"{ticker}.NS",
        price=round(price, 2),
        change=round(change, 2),
        change_pct=round(pct, 4),
        volume=int(vol),
        day_high=round(high or price, 2),
        day_low=round(low or price, 2),
        prev_close=round(prev, 2),
        exchange=exchange,
    )


class GoogleFinanceClient(MarketDataClient):
    """Best-effort quotes from Google Finance (unofficial endpoint)."""

    SOURCE = "Google Finance"

    async def get_quote(self, symbol: str) -> Quote:
        try:
            return await _google_fetch(symbol)
        except ValueError:
            raise
        except Exception as exc:
            log.warning("google_finance.get_quote.error", symbol=symbol, error=str(exc))
            raise RuntimeError(f"Google Finance fetch failed for '{symbol}'") from exc

    async def get_quotes(self, symbols: list[str]) -> list[Quote]:
        results = await asyncio.gather(*[self._safe(s) for s in symbols])
        return [q for q in results if q is not None]

    async def _safe(self, symbol: str) -> Quote | None:
        try:
            return await self.get_quote(symbol)
        except Exception:
            return None
