"""Dashboard market overview — Indian indices, global markets, economic events."""

from __future__ import annotations

import asyncio
import math
import time
from datetime import date, timedelta
from functools import partial

import structlog
from fastapi import APIRouter

from app.api.deps import CurrentUser

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
log = structlog.get_logger()

_CACHE: dict[str, tuple[dict, float]] = {}
_CACHE_TTL = 300  # 5 minutes

_INDIAN_SYMBOLS: list[tuple[str, str]] = [
    ("^NSEI", "Nifty 50"),
    ("^BSESN", "Sensex"),
    ("^NSEBANK", "Bank Nifty"),
    ("^INDIAVIX", "India VIX"),
]
_GLOBAL_SYMBOLS: list[tuple[str, str]] = [
    ("^DJI", "Dow Jones"),
    ("^GSPC", "S&P 500"),
    ("^IXIC", "NASDAQ"),
    ("^N225", "Nikkei 225"),
    ("^FTSE", "FTSE 100"),
    ("GC=F", "Gold (₹/10g proxy)"),
    ("CL=F", "Crude Oil"),
    ("USDINR=X", "USD / INR"),
]


def _fetch_one(sym: str, name: str) -> dict | None:
    import yfinance as yf

    try:
        hist = yf.Ticker(sym).history(period="2d", interval="1d")
        if len(hist) < 1:
            return None
        price = float(hist["Close"].iloc[-1])
        prev = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else price
        high = float(hist["High"].iloc[-1])
        low = float(hist["Low"].iloc[-1])
        if math.isnan(price) or math.isnan(prev) or math.isnan(high) or math.isnan(low):
            # yfinance sometimes returns a row with NaN OHLC instead of an
            # empty frame (seen on ^DJI/^GSPC/^IXIC) -- treat that the same
            # as no data, since NaN serializes to JSON null and the frontend
            # types every IndexQuote field as a non-nullable number.
            return None
        change = round(price - prev, 2)
        change_pct = round((change / prev * 100) if prev else 0, 2)
        return {
            "symbol": sym,
            "name": name,
            "price": round(price, 2),
            "change": change,
            "change_pct": change_pct,
            "high": round(high, 2),
            "low": round(low, 2),
        }
    except Exception as exc:
        log.warning("dashboard.fetch_one.failed", symbol=sym, error=str(exc))
        return None


def _upcoming_fo_expiry(from_date: date) -> list[dict]:
    """Return the next 3 NSE F&O expiry dates (last Thursday of each month)."""
    events = []
    year, month = from_date.year, from_date.month
    for _ in range(3):
        # Find last Thursday of (year, month)
        import calendar

        last_day = calendar.monthrange(year, month)[1]
        d = date(year, month, last_day)
        while d.weekday() != 3:  # Thursday = 3
            d -= timedelta(days=1)
        if d >= from_date:
            events.append(
                {
                    "date": d.isoformat(),
                    "event": "NSE F&O Expiry",
                    "category": "market",
                }
            )
        month += 1
        if month > 12:
            month = 1
            year += 1
    return events


def _build_economic_events() -> list[dict]:
    today = date.today()

    # Known RBI MPC dates for 2026 (announce date = last day of 3-day meeting)
    rbi_mpc = [
        date(2026, 8, 7),
        date(2026, 10, 9),
        date(2026, 12, 4),
    ]
    events: list[dict] = []
    for d in rbi_mpc:
        if d >= today:
            events.append(
                {
                    "date": d.isoformat(),
                    "event": "RBI MPC Decision",
                    "category": "rbi",
                }
            )

    # F&O expiry dates
    events.extend(_upcoming_fo_expiry(today))

    # Results seasons (approximate)
    results_seasons = [
        (date(2026, 7, 14), "Q1 Results Season Starts (Apr–Jun)"),
        (date(2026, 10, 14), "Q2 Results Season Starts (Jul–Sep)"),
    ]
    for d, label in results_seasons:
        if d >= today:
            events.append({"date": d.isoformat(), "event": label, "category": "results"})

    # Union Budget 2027 (early February)
    budget = date(2027, 2, 1)
    if budget >= today:
        events.append(
            {"date": budget.isoformat(), "event": "Union Budget 2027", "category": "budget"}
        )

    events.sort(key=lambda x: x["date"])
    return events[:8]


def _fetch_market_overview_sync() -> dict:
    results_indian = [_fetch_one(sym, name) for sym, name in _INDIAN_SYMBOLS]
    results_global = [_fetch_one(sym, name) for sym, name in _GLOBAL_SYMBOLS]
    return {
        "indices": [r for r in results_indian if r],
        "global": [r for r in results_global if r],
        "economic_events": _build_economic_events(),
        "fetched_at": time.time(),
    }


async def _get_market_overview() -> dict:
    cached = _CACHE.get("overview")
    if cached and (time.time() - cached[1]) < _CACHE_TTL:
        return cached[0]
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, partial(_fetch_market_overview_sync))
    _CACHE["overview"] = (data, time.time())
    return data


@router.get("/market-overview")
async def market_overview(current_user: CurrentUser) -> dict:
    return await _get_market_overview()
