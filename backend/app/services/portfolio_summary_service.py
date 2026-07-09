"""Portfolio Assistant performance summary: winners/losers, sector moves,
and rule-based suggestions for a day/week/month period ending now.

Shared by the /assistant/summary endpoint (live, for "now") and the daily
EOD scheduler job, which stores each user's each portfolio's "day" result
so a specific past date can be looked up later via PortfolioSummaryRepository
instead of recomputed from a rolling yfinance window that only knows "now".
"""

_SUMMARY_LOOKBACK = {"day": 1, "week": 5, "month": 21}


async def compute_portfolio_summary(user_id: str, portfolio_id: str, period: str) -> dict:
    import pandas as pd
    import yfinance as yf

    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    repo = HoldingsRepository()
    holdings = await repo.list_holdings(user_id, portfolio_id)
    if not holdings:
        return {"period": period, "has_data": False}

    lookback = _SUMMARY_LOOKBACK.get(period, 5)
    symbols = [h["symbol"] for h in holdings]
    qty_map = {h["symbol"]: h["qty"] for h in holdings}
    avg_map = {h["symbol"]: h["avg_price"] for h in holdings}
    sector_map = {h["symbol"]: h.get("sector") or "Other" for h in holdings}
    name_map = {h["symbol"]: h.get("name") or h["symbol"] for h in holdings}

    all_syms = symbols + ["^NSEI", "^BSESN"]
    try:
        raw = yf.download(all_syms, period="3mo", auto_adjust=True, progress=False)
        close = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw
    except Exception:
        return {"period": period, "has_data": False}

    close = close.dropna(how="all")
    n = len(close)
    if close.empty or n < 2:
        return {"period": period, "has_data": False}

    idx_start = max(-(lookback + 1), -n)
    row_now = close.iloc[-1]
    row_start = close.iloc[idx_start]

    def _price(row: "pd.Series", sym: str) -> float | None:
        if sym not in row.index:
            return None
        v = row[sym]
        return None if pd.isna(v) else float(v)

    holding_rows: list[dict] = []
    port_now = 0.0
    port_start = 0.0
    sector_now: dict[str, float] = {}
    sector_start: dict[str, float] = {}

    for sym in symbols:
        qty = qty_map[sym]
        p_now = _price(row_now, sym) or avg_map[sym]
        p_start = _price(row_start, sym) or p_now

        val_now = qty * p_now
        val_start = qty * p_start
        port_now += val_now
        port_start += val_start

        sec = sector_map[sym]
        sector_now[sec] = sector_now.get(sec, 0.0) + val_now
        sector_start[sec] = sector_start.get(sec, 0.0) + val_start

        chg_pct = round((p_now - p_start) / p_start * 100, 2) if p_start > 0 else 0.0
        holding_rows.append(
            {
                "symbol": sym,
                "name": name_map[sym],
                "sector": sec,
                "price_start": round(p_start, 2),
                "price_now": round(p_now, 2),
                "change_pct": chg_pct,
                "value_now": round(val_now, 2),
            }
        )

    nifty_now = _price(row_now, "^NSEI")
    nifty_start = _price(row_start, "^NSEI")
    nifty_change_pct = (
        round((nifty_now - nifty_start) / nifty_start * 100, 2)
        if nifty_now and nifty_start and nifty_start > 0
        else None
    )

    sensex_now = _price(row_now, "^BSESN")
    sensex_start = _price(row_start, "^BSESN")
    sensex_change_pct = (
        round((sensex_now - sensex_start) / sensex_start * 100, 2)
        if sensex_now and sensex_start and sensex_start > 0
        else None
    )

    port_change_pct = (
        round((port_now - port_start) / port_start * 100, 2) if port_start > 0 else 0.0
    )
    relative_pct = (
        round(port_change_pct - nifty_change_pct, 2) if nifty_change_pct is not None else None
    )

    holding_rows.sort(key=lambda r: r["change_pct"], reverse=True)
    winners = [r for r in holding_rows if r["change_pct"] > 0]
    losers = sorted((r for r in holding_rows if r["change_pct"] < 0), key=lambda r: r["change_pct"])

    sector_moves = []
    for sec, now_val in sector_now.items():
        start_val = sector_start.get(sec, now_val)
        chg = round((now_val - start_val) / start_val * 100, 2) if start_val > 0 else 0.0
        weight_pct = round(now_val / port_now * 100, 1) if port_now > 0 else 0.0
        sector_moves.append({"sector": sec, "weight_pct": weight_pct, "change_pct": chg})
    sector_moves.sort(key=lambda s: -s["weight_pct"])

    # ── Rule-based suggestions ────────────────────────────────────────────────
    period_label = {"day": "day", "week": "week", "month": "month"}.get(period, period)
    suggestions: list[dict] = []

    if relative_pct is not None:
        if relative_pct <= -3:
            suggestions.append(
                {
                    "severity": "warning",
                    "text": (
                        f"Portfolio underperformed Nifty50 by {abs(relative_pct):.1f}% this "
                        f"{period_label}. Review the laggards below for rotation candidates."
                    ),
                }
            )
        elif relative_pct >= 3:
            suggestions.append(
                {
                    "severity": "positive",
                    "text": (
                        f"Portfolio outperformed Nifty50 by {relative_pct:.1f}% this "
                        f"{period_label} — strong relative strength."
                    ),
                }
            )

    for r in holding_rows:
        bare = r["symbol"].replace(".NS", "").replace(".BO", "")
        if r["change_pct"] <= -8:
            suggestions.append(
                {
                    "severity": "warning",
                    "text": (
                        f"{bare} is down {abs(r['change_pct']):.1f}% this {period_label}. "
                        "Check whether your stop-loss or original thesis still holds."
                    ),
                }
            )
        elif r["change_pct"] >= 15:
            suggestions.append(
                {
                    "severity": "info",
                    "text": (
                        f"{bare} is up {r['change_pct']:.1f}% this {period_label}. "
                        "Consider booking partial profits or trailing your stop."
                    ),
                }
            )

    if sector_moves and sector_moves[0]["weight_pct"] >= 40:
        top = sector_moves[0]
        suggestions.append(
            {
                "severity": "warning",
                "text": (
                    f"{top['sector']} makes up {top['weight_pct']:.0f}% of your portfolio — "
                    "consider diversifying to reduce concentration risk."
                ),
            }
        )

    if not suggestions:
        suggestions.append(
            {
                "severity": "positive",
                "text": f"No major flags this {period_label} — portfolio looks balanced.",
            }
        )

    return {
        "period": period,
        "has_data": True,
        "start_date": str(close.index[idx_start].date()),
        "end_date": str(close.index[-1].date()),
        "portfolio_value_start": round(port_start, 2),
        "portfolio_value_now": round(port_now, 2),
        "portfolio_change_pct": port_change_pct,
        "nifty_change_pct": nifty_change_pct,
        "nifty_value_start": round(nifty_start, 2) if nifty_start is not None else None,
        "nifty_value_now": round(nifty_now, 2) if nifty_now is not None else None,
        "sensex_change_pct": sensex_change_pct,
        "sensex_value_start": round(sensex_start, 2) if sensex_start is not None else None,
        "sensex_value_now": round(sensex_now, 2) if sensex_now is not None else None,
        "relative_pct": relative_pct,
        "winners": winners,
        "losers": losers,
        "sector_moves": sector_moves[:6],
        "suggestions": suggestions[:8],
    }
