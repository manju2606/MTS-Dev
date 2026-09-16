"""USA Stocks movers: Top Gainers/Losers/Most Active for Day/Week/Month, plus
a Momentum list -- a classic screener view layered on top of the same daily
candles/quotes usa_stocks_service already fetches+caches, no new data source.

Day uses the live quote (accurate mid-session change %/volume); Week/Month
compare against the daily candle from ~5/~21 trading days back (yfinance's
daily history only contains trading days, so this is trading-week/month
rather than calendar-exact) and sum daily volumes over that same window.

Momentum is intentionally NOT period-toggled: RSI(14) on daily closes is a
fixed-window technical measure, not naturally a "day vs week vs month"
quantity the way a % return is -- ranked by distance from the neutral 50 so
the most overbought (bullish) and oversold (bearish) names both surface,
independent of whichever Day/Week/Month tab the Gainers/Losers/Most Active
lists are showing.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Literal

from app.infra.mcx import ng_indicators as ind
from app.services.usa_stocks_service import get_klines, get_quotes, get_tracked_codes

MoverPeriod = Literal["day", "week", "month"]

# Trading-day lookback per period -- "day" reads straight off the live quote
# rather than a 1-bar candle lookback (see _period_change_and_volume).
PERIOD_BARS: dict[MoverPeriod, int] = {"day": 1, "week": 5, "month": 21}
MIN_RSI_CANDLES = 15


def _period_change_and_volume(
    period: MoverPeriod, quote: dict | None, price: float, closes: list[float], volumes: list[float]
) -> tuple[float | None, float]:
    if period == "day":
        change = quote.get("change_pct") if quote else None
        volume = quote.get("volume", 0.0) if quote else (volumes[-1] if volumes else 0.0)
        return change, volume

    bars = PERIOD_BARS[period]
    if len(closes) <= bars:
        return None, sum(volumes)
    ref_close = closes[-1 - bars]
    change = (price - ref_close) / ref_close * 100 if ref_close else None
    return change, sum(volumes[-bars:])


async def _stock_row(code: str, quote: dict | None) -> dict | None:
    try:
        candles = await get_klines(code, "1D")
    except Exception:
        return None
    if not candles:
        return None

    closes = ind.closes(candles)
    volumes = ind.volumes(candles)
    price = quote["price"] if quote else closes[-1]

    periods = {}
    for period in PERIOD_BARS:
        change_pct, volume = _period_change_and_volume(period, quote, price, closes, volumes)
        periods[period] = {"change_pct": change_pct, "volume": volume}
    momentum_rsi = ind.rsi(closes, 14) if len(closes) >= MIN_RSI_CANDLES else None

    return {"code": code, "price": price, "periods": periods, "momentum_rsi": momentum_rsi}


def _mover_entry(row: dict, period: MoverPeriod) -> dict:
    p = row["periods"][period]
    change_pct = p["change_pct"]
    return {
        "code": row["code"],
        "price": row["price"],
        "change_pct": round(change_pct, 2) if change_pct is not None else None,
        "volume": int(p["volume"]),
    }


MoverMetric = Literal["change_pct", "volume"]


def _top_n(
    rows: list[dict], period: MoverPeriod, by: MoverMetric, limit: int, reverse: bool
) -> list[dict]:
    eligible = [r for r in rows if r["periods"][period][by] is not None]
    eligible.sort(key=lambda r: r["periods"][period][by], reverse=reverse)
    return [_mover_entry(r, period) for r in eligible[:limit]]


async def get_movers(limit: int = 5) -> dict:
    quotes = await get_quotes()
    quotes_by_code = {q["code"]: q for q in quotes}
    codes = await get_tracked_codes()
    raw_rows = await asyncio.gather(*[_stock_row(c, quotes_by_code.get(c)) for c in codes])
    rows = [r for r in raw_rows if r is not None]

    result: dict = {"generated_at": datetime.utcnow().isoformat()}
    for period in PERIOD_BARS:
        result[period] = {
            "gainers": _top_n(rows, period, "change_pct", limit, reverse=True),
            "losers": _top_n(rows, period, "change_pct", limit, reverse=False),
            "most_active": _top_n(rows, period, "volume", limit, reverse=True),
        }

    momentum_rows = [r for r in rows if r["momentum_rsi"] is not None]
    momentum_rows.sort(key=lambda r: abs(r["momentum_rsi"] - 50), reverse=True)
    result["momentum"] = [
        {
            "code": r["code"],
            "price": r["price"],
            "rsi": round(r["momentum_rsi"], 1),
            "bias": "Bullish" if r["momentum_rsi"] >= 50 else "Bearish",
        }
        for r in momentum_rows[:limit]
    ]
    result["method"] = (
        "Gainers/Losers/Most Active: real price change % and traded volume over the "
        "period (Day=live quote, Week~5/Month~21 trading days). Momentum: RSI(14) on "
        "daily closes ranked by distance from neutral 50 -- not period-toggled."
    )
    return result
