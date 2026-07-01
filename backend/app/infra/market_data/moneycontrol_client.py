"""MoneyControl price API client.

MoneyControl exposes a widget price-feed endpoint at:
  https://priceapi.moneycontrol.com/pricefeed/nse/equitycash/{mc_id}

The MoneyControl ID differs from the NSE symbol for some stocks.  The
mapping table below covers the Nifty 50 universe + extended list.  For
unmapped symbols the NSE ticker is tried as-is (works for most Nifty 50
stocks where the MC ID equals the NSE symbol).
"""

import asyncio
import math

import httpx
import structlog

from app.domain.interfaces.market_data import MarketDataClient
from app.domain.models.quote import Quote

log = structlog.get_logger()

_BASE = "https://priceapi.moneycontrol.com/pricefeed"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":   "application/json, text/plain, */*",
    "Referer":  "https://www.moneycontrol.com/",
    "Origin":   "https://www.moneycontrol.com",
}

# NSE symbol (without suffix) → MoneyControl ID
_MC_ID: dict[str, str] = {
    "RELIANCE":    "RELI",
    "TCS":         "TCS",
    "HDFCBANK":    "HDF01",
    "INFY":        "INFY",
    "ICICIBANK":   "ICICIBANK",
    "HINDUNILVR":  "HLL",
    "SBIN":        "SBI",
    "BHARTIARTL":  "BAL",
    "ITC":         "ITC",
    "KOTAKBANK":   "KOTAKNSE",
    "LT":          "LT",
    "HCLTECH":     "HCL02",
    "BAJFINANCE":  "BAF",
    "AXISBANK":    "AXSB",
    "WIPRO":       "WIP",
    "ASIANPAINT":  "APL",
    "MARUTI":      "MUL",
    "ULTRACEMCO":  "ULTACEM",
    "TATAMOTORS":  "TAMO",
    "TATASTEEL":   "TATA01",
    "SUNPHARMA":   "SUNP",
    "NTPC":        "NTPC",
    "POWERGRID":   "PWG",
    "TITAN":       "TITN",
    "BAJAJFINSV":  "BAJ",
    "ONGC":        "ONGC",
    "COALINDIA":   "COAL",
    "TECHM":       "TECHM",
    "INDUSINDBK":  "INBK",
    "HDFCLIFE":    "HDFCLIFE",
    "CIPLA":       "CPL",
    "DRREDDY":     "DRR",
    "DIVISLAB":    "DIVL",
    "HINDALCO":    "HNDL",
    "GRASIM":      "GRM",
    "ADANIENT":    "ADE",
    "ADANIPORTS":  "ADP",
    "JSWSTEEL":    "JSW",
    "TATACONSUM":  "TATAC",
    "HEROMOTOCO":  "HER",
    "BRITANNIA":   "BRI",
    "BAJAJ-AUTO":  "BJAUTO",
    "APOLLOHOSP":  "APLH",
    "BPCL":        "BPCL",
    "EICHERMOT":   "EICM",
    "UPL":         "UPL",
    "SBILIFE":     "SBIL",
    "VEDL":        "VEDL",
    "JSWENERGY":   "JSWE",
    "PIDILITIND":  "PIDI",
    "TATAPOWER":   "TPWR",
}


def _mc_id(nse_symbol: str) -> str:
    """Return MoneyControl ID for a given NSE symbol (without suffix)."""
    clean = nse_symbol.upper().replace(".NS", "").replace(".BO", "")
    return _MC_ID.get(clean, clean)


def _safe_float(v: object, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        f = float(str(v).replace(",", ""))  # type: ignore[arg-type]
        return default if math.isnan(f) else f
    except (TypeError, ValueError):
        return default


async def _mc_fetch(symbol: str) -> Quote:
    clean = symbol.upper().replace(".NS", "").replace(".BO", "")
    exchange = "bse" if symbol.upper().endswith(".BO") else "nse"
    mc_id = _mc_id(clean)
    url = f"{_BASE}/{exchange}/equitycash/{mc_id}"

    async with httpx.AsyncClient(headers=_HEADERS, timeout=10.0, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()

    # MoneyControl response structure varies; try multiple key paths
    # Typical: {"data": {"lastprice": "2847.50", "change": "12.30", ...}}
    payload = data.get("data") or data.get("priceFeedData") or data
    if isinstance(payload, list):
        payload = payload[0] if payload else {}

    price = _safe_float(
        payload.get("lastprice") or payload.get("last") or payload.get("price")
    )
    if price == 0:
        raise ValueError(f"MoneyControl returned no price for '{symbol}' (mc_id={mc_id})")

    prev = _safe_float(payload.get("previousclose") or payload.get("prev_close"), price)
    change = round(price - prev, 2)
    pct = round(change / prev * 100, 4) if prev else 0.0

    return Quote(
        symbol=symbol.upper() if symbol.upper().endswith((".NS", ".BO")) else f"{clean}.NS",
        price=round(price, 2),
        change=_safe_float(payload.get("change"), change),
        change_pct=_safe_float(payload.get("pchange") or payload.get("change_percent"), pct),
        volume=int(_safe_float(payload.get("volume") or payload.get("totaltradedvolume"), 0)),
        day_high=round(_safe_float(payload.get("high") or payload.get("day_high"), price), 2),
        day_low=round(_safe_float(payload.get("low") or payload.get("day_low"), price), 2),
        prev_close=round(prev, 2),
        exchange="BSE" if exchange == "bse" else "NSE",
    )


class MoneyControlClient(MarketDataClient):
    """Quotes from MoneyControl's widget price-feed API."""

    SOURCE = "MoneyControl"

    async def get_quote(self, symbol: str) -> Quote:
        try:
            return await _mc_fetch(symbol)
        except ValueError:
            raise
        except Exception as exc:
            log.warning("moneycontrol.get_quote.error", symbol=symbol, error=str(exc))
            raise RuntimeError(f"MoneyControl fetch failed for '{symbol}'") from exc

    async def get_quotes(self, symbols: list[str]) -> list[Quote]:
        results = await asyncio.gather(*[self._safe(s) for s in symbols])
        return [q for q in results if q is not None]

    async def _safe(self, symbol: str) -> Quote | None:
        try:
            return await self.get_quote(symbol)
        except Exception:
            return None
