"""Portfolio Assistant OHLC: per-holding Open/High/Low/Close, daily/weekly/
monthly change, and 52-week high/low.

Computed live each time the OHLC tab loads -- unlike the Summary tab's
%-change (which is anchored to "now" and loses meaning once "now" moves on),
OHLC and 52w-high/low are well-defined facts yfinance already retains, so
there's no separate daily snapshot job here.
"""

_LOOKBACK = {"week": 5, "month": 21}
_TRADING_DAYS_52W = 252


async def compute_portfolio_ohlc(user_id: str, portfolio_id: str) -> dict:
    import asyncio

    import pandas as pd
    import yfinance as yf

    from app.infra.db.repositories.discovery_repo import DiscoveryRepository
    from app.infra.db.repositories.holdings_repo import HoldingsRepository
    from app.infra.market_data.composite_client import CompositeMarketDataClient

    repo = HoldingsRepository()
    holdings = await repo.list_holdings(user_id, portfolio_id)
    if not holdings:
        return {"has_data": False, "rows": []}

    symbols = [h["symbol"] for h in holdings]
    name_map = {h["symbol"]: h.get("name") or h["symbol"] for h in holdings}
    sector_map = {h["symbol"]: h.get("sector") or "Other" for h in holdings}

    # LTP (live quote) and AI signal/confidence (latest Discovery Engine scan)
    # for each holding, fetched concurrently -- independent of the OHLC
    # history download below.
    quotes, scores = await asyncio.gather(
        CompositeMarketDataClient().get_quotes(symbols),
        DiscoveryRepository().get_top_picks(limit=3000),
    )
    quote_map = {q.symbol: q for q in quotes}
    score_map = {s.symbol: s for s in scores}

    try:
        # 14mo, not 1y: leaves headroom so the 52w high/low window and the
        # weekly/monthly trailing offsets both have enough rows before the
        # latest close, even accounting for holidays/thin trading.
        raw = yf.download(symbols, period="14mo", auto_adjust=True, progress=False)
    except Exception:
        return {"has_data": False, "rows": []}

    if raw.empty:
        return {"has_data": False, "rows": []}

    is_multi = isinstance(raw.columns, pd.MultiIndex)

    def _field(field: str, sym: str) -> "pd.Series | None":
        if is_multi:
            if (field, sym) not in raw.columns:
                return None
            return raw[(field, sym)].dropna()
        if field not in raw.columns:
            return None
        return raw[field].dropna()

    def _at(series: "pd.Series | None", offset: int) -> float | None:
        if series is None or len(series) == 0:
            return None
        j = -1 - offset
        if -j > len(series):
            return None
        return float(series.iloc[j])

    def _last(series: "pd.Series | None") -> float | None:
        return float(series.iloc[-1]) if series is not None and len(series) else None

    rows: list[dict] = []
    for sym in symbols:
        close = _field("Close", sym)
        if close is None or len(close) < 2:
            continue
        open_ = _field("Open", sym)
        high = _field("High", sym)
        low = _field("Low", sym)

        n = len(close)
        c_now = float(close.iloc[-1])
        c_prev = float(close.iloc[-2])
        change = round(c_now - c_prev, 2)
        change_pct = round(change / c_prev * 100, 2) if c_prev else 0.0

        week_ago = _at(close, _LOOKBACK["week"])
        month_ago = _at(close, _LOOKBACK["month"])
        weekly_change = round(c_now - week_ago, 2) if week_ago else None
        weekly_change_pct = round(weekly_change / week_ago * 100, 2) if week_ago else None
        monthly_change = round(c_now - month_ago, 2) if month_ago else None
        monthly_change_pct = round(monthly_change / month_ago * 100, 2) if month_ago else None

        window = min(n, _TRADING_DAYS_52W)
        high_52w = float(high.iloc[-window:].max()) if high is not None and len(high) else None
        low_52w = float(low.iloc[-window:].min()) if low is not None and len(low) else None

        quote = quote_map.get(sym)
        score = score_map.get(sym)

        rows.append(
            {
                "symbol": sym,
                "name": name_map[sym],
                "sector": sector_map[sym],
                "date": str(close.index[-1].date()),
                "open": round(o, 2) if (o := _last(open_)) is not None else None,
                "high": round(h, 2) if (h := _last(high)) is not None else None,
                "low": round(low_now, 2) if (low_now := _last(low)) is not None else None,
                "close": round(c_now, 2),
                "change": change,
                "change_pct": change_pct,
                "week_52_high": round(high_52w, 2) if high_52w is not None else None,
                "week_52_low": round(low_52w, 2) if low_52w is not None else None,
                "weekly_change": weekly_change,
                "weekly_change_pct": weekly_change_pct,
                "monthly_change": monthly_change,
                "monthly_change_pct": monthly_change_pct,
                "ltp": round(quote.price, 2) if quote else None,
                "ai_signal": score.signal if score else None,
                "confidence_pct": round(score.confidence * 100, 1) if score else None,
            }
        )

    rows.sort(key=lambda r: r["symbol"])
    return {"has_data": len(rows) > 0, "rows": rows}
