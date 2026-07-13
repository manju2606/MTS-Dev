"""Global Natural Gas symbols dashboard -- MCX Natural Gas / Natural Gas
Mini (India, via the connected Zerodha Kite account -- real quote + the
actual NG-AI Pro score) alongside the handful of international NG
benchmarks that have genuinely usable data via yfinance: Henry Hub
(NYMEX, USA) and Dutch TTF (ICE, Europe).

UK NBP gas and JKM LNG were investigated and deliberately left out: Yahoo
Finance has no usable OHLC data for either right now (fast_info returns
NaN, history() returns a single stale zero-volume row) -- showing them
would mean fabricated-looking zeros, not a real quote. If Yahoo ever
carries real data for those, add them to _GLOBAL_TICKERS below.

Foreign symbols don't have Kite-level order-flow/OI data, so they get a
simpler read than MCX's own full 8-category NG-AI Pro score: "AI Strength"
for those rows is the same EMA/ADX/MACD trend-strength (0-100) used for the
Trend column, not the full weighted score -- see ai_strength_source in each
row ("ai-score" vs "trend-strength") so the frontend can be transparent
about which is which.

"Next Event" is deliberately limited to facts that are actually known
without a news/economic-calendar API (which this app doesn't have -- see
mcx_ai_score_service.py's own docstring on the same limitation): MCX rows
show the real contract expiry from Kite; Henry Hub shows the next EIA
Weekly Natural Gas Storage Report, a fixed public schedule (Thursdays,
10:30 AM US Eastern -- not adjusted for US holidays, which occasionally
shift it a day). Dutch TTF has no equivalent fixed weekly report, so its
next-event is left blank rather than guessed.
"""

from __future__ import annotations

import asyncio
import math
from datetime import datetime, timedelta
from functools import partial
from zoneinfo import ZoneInfo

from app.services.mcx_ai_score_service import compute_ng_ai_score
from app.services.mcx_service import get_history, get_quote
from app.services.mcx_trend_service import classify_trend

_ET = ZoneInfo("America/New_York")
_IST = ZoneInfo("Asia/Kolkata")


def _next_eia_report_ist() -> str:
    """Next EIA Weekly Natural Gas Storage Report, Thursdays 10:30 AM ET,
    converted to IST for display alongside everything else in this app."""
    now_et = datetime.now(_ET)
    days_ahead = (3 - now_et.weekday()) % 7  # Thursday == weekday 3
    report_time = now_et.replace(hour=10, minute=30, second=0, microsecond=0)
    candidate = report_time + timedelta(days=days_ahead)
    if candidate <= now_et:
        candidate += timedelta(days=7)
    return candidate.astimezone(_IST).isoformat()

_GLOBAL_TICKERS: dict[str, dict[str, str]] = {
    "henry_hub": {
        "ticker": "NG=F",
        "display": "Henry Hub Natural Gas",
        "exchange": "NYMEX",
        "market": "USA",
    },
    "ttf": {
        "ticker": "TTF=F",
        "display": "Dutch TTF Natural Gas",
        "exchange": "ICE",
        "market": "Europe",
    },
}


def _fetch_yf_daily_sync(ticker: str) -> list[dict]:
    import yfinance as yf

    hist = yf.Ticker(ticker).history(period="6mo", interval="1d", auto_adjust=True)
    out = []
    for idx, row in hist.iterrows():
        out.append(
            {
                "time": int(idx.timestamp()),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": int(row["Volume"]) if not math.isnan(row["Volume"]) else 0,
            }
        )
    return out


async def get_henry_hub_candles() -> list[dict]:
    """Raw daily OHLCV candles for Henry Hub (NYMEX, via yfinance "NG=F") --
    the same fetch _global_ticker_row already does for its snapshot row, just
    returning the full series instead of collapsing it to a last-bar summary.
    Powers the "NG Global" chart tab (frontend/components/ng-global-chart.tsx),
    which needs actual candles to draw rather than a single quote."""
    loop = asyncio.get_event_loop()
    ticker = _GLOBAL_TICKERS["henry_hub"]["ticker"]
    return await loop.run_in_executor(None, partial(_fetch_yf_daily_sync, ticker))


async def _global_ticker_row(key: str, cfg: dict[str, str]) -> dict:
    loop = asyncio.get_event_loop()
    try:
        candles = await loop.run_in_executor(None, partial(_fetch_yf_daily_sync, cfg["ticker"]))
    except Exception as exc:
        candles = []
        note = f"Yahoo Finance fetch failed: {exc}"
    else:
        note = None

    next_event = _next_eia_report_ist() if cfg["ticker"] == "NG=F" else None
    next_event_label = "EIA Weekly Storage Report" if next_event else None

    if len(candles) < 2:
        return {
            "key": key,
            "symbol": cfg["ticker"],
            "display_symbol": cfg["display"],
            "exchange": cfg["exchange"],
            "market": cfg["market"],
            "ltp": None,
            "change": None,
            "change_pct": None,
            "open": None,
            "high": None,
            "low": None,
            "prev_close": None,
            "trend": "UNKNOWN",
            "ai_strength": None,
            "ai_strength_source": None,
            "next_event": next_event,
            "next_event_label": next_event_label,
            "note": note or "No usable data from Yahoo Finance right now.",
        }

    last, prev = candles[-1], candles[-2]
    ltp = last["close"]
    prev_close = prev["close"]
    change = round(ltp - prev_close, 4)
    change_pct = round(change / prev_close * 100, 2) if prev_close else 0.0
    trend = classify_trend(candles)

    return {
        "key": key,
        "symbol": cfg["ticker"],
        "display_symbol": cfg["display"],
        "exchange": cfg["exchange"],
        "market": cfg["market"],
        "ltp": round(ltp, 4),
        "change": change,
        "change_pct": change_pct,
        "open": round(last["open"], 4),
        "high": round(last["high"], 4),
        "low": round(last["low"], 4),
        "prev_close": round(prev_close, 4),
        "trend": trend["direction"],
        "ai_strength": trend["strength"],
        "ai_strength_source": "trend-strength",
        "next_event": next_event,
        "next_event_label": next_event_label,
    }


async def _mcx_symbol_row(user_id: str, contract: str) -> dict:
    quote = await get_quote(user_id, contract)
    candles = await get_history(user_id, "1D", contract)
    trend = classify_trend(candles)
    score = await compute_ng_ai_score(user_id, "BUY", 100_000.0, contract)

    return {
        "key": contract.upper(),
        "symbol": quote["tradingsymbol"],
        "display_symbol": "MCX Natural Gas" if contract == "NG" else "MCX Natural Gas Mini",
        "exchange": "MCX",
        "market": "India",
        "ltp": quote["last_price"],
        "change": quote["change"],
        "change_pct": quote["change_pct"],
        "open": quote["open"],
        "high": quote["high"],
        "low": quote["low"],
        "prev_close": quote["prev_close"],
        "trend": trend["direction"],
        "ai_strength": score["score_pct"],
        "ai_strength_source": "ai-score",
        "next_event": quote["expiry"],
        "next_event_label": "Contract Expiry",
    }


async def get_global_symbols(user_id: str) -> list[dict]:
    rows: list[dict] = []
    for contract in ("NG", "NGMINI"):
        try:
            rows.append(await _mcx_symbol_row(user_id, contract))
        except Exception as exc:
            rows.append(
                {
                    "key": contract.upper(),
                    "symbol": contract,
                    "display_symbol": (
                        "MCX Natural Gas" if contract == "NG" else "MCX Natural Gas Mini"
                    ),
                    "exchange": "MCX",
                    "market": "India",
                    "ltp": None,
                    "change": None,
                    "change_pct": None,
                    "open": None,
                    "high": None,
                    "low": None,
                    "prev_close": None,
                    "trend": "UNKNOWN",
                    "ai_strength": None,
                    "ai_strength_source": None,
                    "next_event": None,
                    "next_event_label": None,
                    "note": str(exc),
                }
            )
    for key, cfg in _GLOBAL_TICKERS.items():
        rows.append(await _global_ticker_row(key, cfg))
    return rows
