"""NSE India direct API client.

Calls the NSE website's undocumented JSON endpoints to retrieve real-time
(or near-real-time) equity quotes.  The site requires a browser-like
session — we hit the homepage first to obtain cookies, then make the API
call.  The cookie jar is cached in memory for 25 minutes; on a 401/403
the session is re-established automatically.
"""

import asyncio
import math
from datetime import datetime, timedelta

import httpx
import structlog

from app.domain.interfaces.market_data import MarketDataClient
from app.domain.models.quote import Quote

log = structlog.get_logger()

_BASE = "https://www.nseindia.com"

# Browser-like headers required by NSE — without these you get 401/403
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer":         "https://www.nseindia.com/",
    "Connection":      "keep-alive",
    "sec-fetch-site":  "same-origin",
    "sec-fetch-mode":  "cors",
    "sec-fetch-dest":  "empty",
    "X-Requested-With":"XMLHttpRequest",
}

# ── Session cache (module-level, single process) ──────────────────────────────

_cached_cookies: dict[str, str] = {}
_cookie_expires: datetime = datetime.utcnow()
_session_lock = asyncio.Lock()


async def _get_session_cookies() -> dict[str, str]:
    global _cached_cookies, _cookie_expires
    async with _session_lock:
        if _cached_cookies and datetime.utcnow() < _cookie_expires:
            return _cached_cookies
        try:
            async with httpx.AsyncClient(
                headers=_HEADERS,
                follow_redirects=True,
                timeout=15.0,
            ) as client:
                resp = await client.get(_BASE)
                cookies = dict(resp.cookies)
                if cookies:
                    _cached_cookies = cookies
                    _cookie_expires = datetime.utcnow() + timedelta(minutes=25)
                    log.info("nse.session.refreshed", cookie_count=len(cookies))
                    return cookies
        except Exception as exc:
            log.warning("nse.session.error", error=str(exc))
        return _cached_cookies


def _safe_float(v: object, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        f = float(v)  # type: ignore[arg-type]
        return default if math.isnan(f) else f
    except (TypeError, ValueError):
        return default


def _strip_suffix(symbol: str) -> str:
    return symbol.upper().replace(".NS", "").replace(".BO", "")


async def _fetch_equity_quote(raw_symbol: str) -> Quote:
    nse_symbol = _strip_suffix(raw_symbol)
    cookies = await _get_session_cookies()

    async with httpx.AsyncClient(
        headers=_HEADERS,
        cookies=cookies,
        follow_redirects=True,
        timeout=12.0,
    ) as client:
        resp = await client.get(
            f"{_BASE}/api/quote-equity",
            params={"symbol": nse_symbol},
        )

    if resp.status_code in (401, 403):
        # Cookie expired — clear and retry once
        global _cached_cookies, _cookie_expires
        _cached_cookies = {}
        _cookie_expires = datetime.utcnow()
        cookies = await _get_session_cookies()
        async with httpx.AsyncClient(
            headers=_HEADERS, cookies=cookies, timeout=12.0,
        ) as client:
            resp = await client.get(
                f"{_BASE}/api/quote-equity",
                params={"symbol": nse_symbol},
            )

    if resp.status_code == 404:
        raise ValueError(f"Symbol '{nse_symbol}' not found on NSE India")
    resp.raise_for_status()

    data = resp.json()
    pi = data.get("priceInfo", {})
    if not pi:
        raise ValueError(f"No priceInfo in NSE India response for '{nse_symbol}'")

    last   = _safe_float(pi.get("lastPrice") or pi.get("last"))
    prev   = _safe_float(pi.get("previousClose"), last)
    change = round(_safe_float(pi.get("change"), last - prev), 2)
    pct    = round(_safe_float(pi.get("pChange"), change / prev * 100 if prev else 0), 4)

    return Quote(
        symbol=raw_symbol.upper() if raw_symbol.upper().endswith((".NS", ".BO")) else f"{nse_symbol}.NS",
        price=round(last, 2),
        change=change,
        change_pct=pct,
        volume=int(_safe_float(pi.get("totalTradedVolume") or pi.get("totalMarketCap", 0))),
        day_high=round(_safe_float(pi.get("dayHigh") or pi.get("high"), last), 2),
        day_low=round(_safe_float(pi.get("dayLow") or pi.get("low"), last), 2),
        prev_close=round(prev, 2),
        exchange="NSE",
    )


class NseIndiaClient(MarketDataClient):
    """Fetches real-time quotes from NSE India's internal JSON API."""

    SOURCE = "NSE India"

    async def get_quote(self, symbol: str) -> Quote:
        try:
            return await _fetch_equity_quote(symbol)
        except ValueError:
            raise
        except Exception as exc:
            log.warning("nse_india.get_quote.error", symbol=symbol, error=str(exc))
            raise RuntimeError(f"NSE India fetch failed for '{symbol}': {exc}") from exc

    async def get_quotes(self, symbols: list[str]) -> list[Quote]:
        results = await asyncio.gather(
            *[self._safe_get(s) for s in symbols], return_exceptions=False
        )
        return [q for q in results if q is not None]

    async def _safe_get(self, symbol: str) -> Quote | None:
        try:
            return await self.get_quote(symbol)
        except Exception as exc:
            log.warning("nse_india.get_quotes.skip", symbol=symbol, error=str(exc))
            return None
