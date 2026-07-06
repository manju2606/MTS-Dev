"""Economic calendar — Indian market events + earnings from yfinance."""
from __future__ import annotations

import asyncio
from datetime import date, timedelta
from functools import partial

import structlog
from fastapi import APIRouter, Query

from app.api.deps import CurrentUser

router = APIRouter(prefix="/calendar", tags=["economic-calendar"])
log = structlog.get_logger()

# ── Static Indian market events (recurring / known) ──────────────────────────

def _static_events(from_date: date, to_date: date) -> list[dict]:
    """Generate well-known recurring NSE events within the date range."""
    events: list[dict] = []

    # F&O expiry — last Thursday of every month
    cur = date(from_date.year, from_date.month, 1)
    while cur <= to_date:
        # find last Thursday of cur.month
        last_day = date(cur.year, cur.month + 1, 1) - timedelta(days=1) if cur.month < 12 else date(cur.year, 12, 31)
        thursday = last_day
        while thursday.weekday() != 3:  # 3 = Thursday
            thursday -= timedelta(days=1)
        if from_date <= thursday <= to_date:
            events.append({
                "id": f"fo_expiry_{thursday.isoformat()}",
                "date": thursday.isoformat(),
                "type": "fo_expiry",
                "title": "NSE F&O Monthly Expiry",
                "description": "Monthly Futures & Options contracts expire on NSE.",
                "impact": "high",
                "symbol": None,
            })
        cur = date(cur.year + (1 if cur.month == 12 else 0), cur.month % 12 + 1, 1)

    # Weekly F&O expiry — every Thursday
    thursday = from_date
    while thursday.weekday() != 3:
        thursday += timedelta(days=1)
    while thursday <= to_date:
        # Skip if it's already the monthly expiry date (already added above)
        already = any(e["date"] == thursday.isoformat() and e["type"] == "fo_expiry" for e in events)
        if not already:
            events.append({
                "id": f"weekly_expiry_{thursday.isoformat()}",
                "date": thursday.isoformat(),
                "type": "weekly_expiry",
                "title": "NSE Weekly Expiry (Nifty / BankNifty)",
                "description": "Weekly index options expire on NSE every Thursday.",
                "impact": "medium",
                "symbol": None,
            })
        thursday += timedelta(days=7)

    # RBI Monetary Policy Committee — typically 6 times a year (Feb, Apr, Jun, Aug, Oct, Dec)
    rbi_months = {2, 4, 6, 8, 10, 12}
    for year in range(from_date.year, to_date.year + 1):
        for month in rbi_months:
            # typically around the 7th–8th of the month (Friday)
            try:
                rbi_date = date(year, month, 7)
            except ValueError:
                continue
            # move to next Friday
            while rbi_date.weekday() != 4:
                rbi_date += timedelta(days=1)
            if from_date <= rbi_date <= to_date:
                events.append({
                    "id": f"rbi_mpc_{rbi_date.isoformat()}",
                    "date": rbi_date.isoformat(),
                    "type": "central_bank",
                    "title": "RBI Monetary Policy Decision",
                    "description": "RBI MPC announces repo rate decision and policy statement.",
                    "impact": "high",
                    "symbol": None,
                })

    # NSE/BSE market holidays 2026 (approximate)
    holidays_2026 = [
        ("2026-01-26", "Republic Day"),
        ("2026-03-13", "Holi"),
        ("2026-04-03", "Good Friday"),
        ("2026-04-14", "Dr. Ambedkar Jayanti"),
        ("2026-05-01", "Maharashtra Day"),
        ("2026-08-15", "Independence Day"),
        ("2026-10-02", "Gandhi Jayanti"),
        ("2026-10-20", "Diwali Laxmi Pujan"),
        ("2026-11-04", "Gurunanak Jayanti"),
        ("2026-12-25", "Christmas"),
    ]
    for hdate, hname in holidays_2026:
        try:
            hd = date.fromisoformat(hdate)
        except ValueError:
            continue
        if from_date <= hd <= to_date:
            events.append({
                "id": f"holiday_{hdate}",
                "date": hdate,
                "type": "market_holiday",
                "title": f"Market Holiday: {hname}",
                "description": f"NSE and BSE closed for {hname}.",
                "impact": "info",
                "symbol": None,
            })

    return events


# ── Earnings from yfinance ────────────────────────────────────────────────────

_NIFTY50_SAMPLE = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "HINDUNILVR.NS", "SBIN.NS", "BAJFINANCE.NS", "BHARTIARTL.NS", "KOTAKBANK.NS",
    "WIPRO.NS", "AXISBANK.NS", "MARUTI.NS", "LT.NS", "ASIANPAINT.NS",
    "TATAMOTORS.NS", "SUNPHARMA.NS", "TITAN.NS", "NESTLEIND.NS", "POWERGRID.NS",
]


def _earnings_for(symbol: str, from_date: date, to_date: date) -> list[dict]:
    import yfinance as yf
    try:
        cal = yf.Ticker(symbol).calendar
        if cal is None or cal.empty:
            return []
        for col in ["Earnings Date", "earnings_date", 0]:
            if col in cal.columns if hasattr(cal, "columns") else col in cal.index:
                try:
                    raw = cal[col].iloc[0] if hasattr(cal, "columns") else cal.loc[col]
                    edate = raw.date() if hasattr(raw, "date") else date.fromisoformat(str(raw)[:10])
                    if from_date <= edate <= to_date:
                        short = symbol.replace(".NS", "").replace(".BO", "")
                        return [{
                            "id": f"earnings_{symbol}_{edate.isoformat()}",
                            "date": edate.isoformat(),
                            "type": "earnings",
                            "title": f"{short} Quarterly Results",
                            "description": f"{short} Q earnings announcement.",
                            "impact": "medium",
                            "symbol": symbol,
                        }]
                except Exception:
                    pass
    except Exception:
        pass
    return []


async def _fetch_earnings(from_date: date, to_date: date) -> list[dict]:
    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(None, partial(_earnings_for, sym, from_date, to_date))
        for sym in _NIFTY50_SAMPLE
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    events: list[dict] = []
    for r in results:
        if isinstance(r, list):
            events.extend(r)
    return events


# ── endpoint ──────────────────────────────────────────────────────────────────

@router.get("/events")
async def get_events(
    _: CurrentUser,
    from_date: str = Query(default="", description="YYYY-MM-DD"),
    to_date: str = Query(default="", description="YYYY-MM-DD"),
) -> list[dict]:
    today = date.today()
    try:
        fd = date.fromisoformat(from_date) if from_date else today
        td = date.fromisoformat(to_date) if to_date else today + timedelta(days=30)
    except ValueError:
        fd, td = today, today + timedelta(days=30)

    if td < fd:
        td = fd + timedelta(days=30)

    static = _static_events(fd, td)
    earnings = await _fetch_earnings(fd, td)

    all_events = sorted(static + earnings, key=lambda e: e["date"])
    return all_events
