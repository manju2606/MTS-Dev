"""Portfolio P&L summary — open positions with live prices + closed trade history.

Also hosts the Portfolio Assistant endpoints (/portfolio/holdings/* and
/portfolio/assistant/*) for tracking real brokerage holdings with AI analysis.
"""

import asyncio
from datetime import datetime

from fastapi import APIRouter, Body, HTTPException, status

from app.api.deps import CurrentUser, MarketDataDep, TradeDep
from app.domain.models.trade import TradeSignal, TradeStatus
from app.infra.scanner.universe import SECTORS

_SYMBOL_SECTOR: dict[str, str] = {
    sym: sector for sector, syms in SECTORS.items() for sym in syms
}

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


def _unrealized(signal: str, entry: float, current: float, qty: int) -> float:
    if signal == TradeSignal.BUY:
        return round((current - entry) * qty, 2)
    return round((entry - current) * qty, 2)


@router.get("/summary")
async def portfolio_summary(
    current_user: CurrentUser,
    repo: TradeDep,
    market_data: MarketDataDep,
) -> dict:
    all_trades = await repo.list_by_user(current_user.id)
    open_trades = [t for t in all_trades if t.status == TradeStatus.OPEN]
    closed_trades = [t for t in all_trades if t.status == TradeStatus.CLOSED]

    # Fetch live prices for open positions (parallel)
    symbols = list({t.symbol for t in open_trades})
    quotes: dict[str, float] = {}
    if symbols:
        results = await asyncio.gather(
            *[market_data.get_quote(s) for s in symbols], return_exceptions=True
        )
        for sym, r in zip(symbols, results, strict=True):
            if not isinstance(r, Exception):
                quotes[sym] = r.price

    # Build open positions
    positions = []
    for t in open_trades:
        current_price = quotes.get(t.symbol, t.entry_price)
        invested = round(t.entry_price * t.quantity, 2)
        unreal = _unrealized(t.signal.value, t.entry_price, current_price, t.quantity)
        unreal_pct = round(unreal / invested * 100, 2) if invested else 0.0
        ref = t.opened_at or t.created_at
        days_held = (datetime.utcnow() - ref).days
        positions.append({
            "id": str(t.id),
            "symbol": t.symbol,
            "exchange": t.exchange,
            "signal": t.signal.value,
            "quantity": t.quantity,
            "entry_price": t.entry_price,
            "current_price": current_price,
            "stop_loss": t.stop_loss,
            "target": t.target,
            "invested": invested,
            "unrealized_pnl": unreal,
            "unrealized_pnl_pct": unreal_pct,
            "days_held": days_held,
            "ai_confidence": t.ai_confidence,
            "opened_at": t.opened_at.isoformat() if t.opened_at else None,
            "sector": _SYMBOL_SECTOR.get(t.symbol, "Other"),
        })

    # Closed trades (most recent first)
    closed_list = []
    for t in sorted(closed_trades, key=lambda x: x.closed_at or datetime.min, reverse=True):
        invested = round(t.entry_price * t.quantity, 2)
        pnl = t.pnl or 0.0
        pnl_pct = round(pnl / invested * 100, 2) if invested else 0.0
        ref_open = t.opened_at or t.created_at
        days = (t.closed_at - ref_open).days if t.closed_at else 0
        closed_list.append({
            "id": str(t.id),
            "symbol": t.symbol,
            "exchange": t.exchange,
            "signal": t.signal.value,
            "quantity": t.quantity,
            "entry_price": t.entry_price,
            "exit_price": t.exit_price,
            "pnl": pnl,
            "pnl_pct": pnl_pct,
            "days_held": days,
            "closed_at": t.closed_at.isoformat() if t.closed_at else None,
        })

    # Equity curve — cumulative realized P&L ordered by close date
    equity_curve: list[dict] = []
    sorted_closed = sorted(
        [t for t in closed_trades if t.closed_at],
        key=lambda x: x.closed_at,  # type: ignore[arg-type]
    )
    cum = 0.0
    for t in sorted_closed:
        cum += t.pnl or 0.0
        equity_curve.append({
            "time": int(t.closed_at.timestamp()),  # type: ignore[union-attr]
            "value": round(cum, 2),
        })

    # Sector allocation (by invested value in open positions)
    sector_allocation: dict[str, float] = {}
    for pos in positions:
        sec = pos["sector"]
        sector_allocation[sec] = round(sector_allocation.get(sec, 0.0) + pos["invested"], 2)

    # Summary
    total_invested = sum(t.entry_price * t.quantity for t in open_trades)
    unrealized_total = sum(p["unrealized_pnl"] for p in positions)
    realized_total = sum(t.pnl or 0.0 for t in closed_trades)
    winners = sum(1 for t in closed_trades if (t.pnl or 0.0) > 0)
    n_closed = len(closed_trades)
    win_rate = round(winners / n_closed * 100, 1) if n_closed else 0.0

    return {
        "summary": {
            "total_invested": round(total_invested, 2),
            "unrealized_pnl": round(unrealized_total, 2),
            "realized_pnl": round(realized_total, 2),
            "total_pnl": round(unrealized_total + realized_total, 2),
            "open_positions": len(open_trades),
            "closed_trades": n_closed,
            "total_trades": len(all_trades),
            "winners": winners,
            "losers": n_closed - winners,
            "win_rate": win_rate,
        },
        "positions": positions,
        "closed_trades": closed_list,
        "equity_curve": equity_curve,
        "sector_allocation": sector_allocation,
    }


# ── Portfolio Assistant — Holdings CRUD ───────────────────────────────────────

_SECTOR_MAP: dict[str, str] = {
    sym: sector for sector, syms in SECTORS.items() for sym in syms
}


@router.get("/holdings")
async def list_holdings(current_user: CurrentUser) -> list[dict]:
    from app.infra.db.repositories.holdings_repo import HoldingsRepository
    repo = HoldingsRepository()
    return await repo.list_holdings(str(current_user.id))


@router.post("/holdings", status_code=status.HTTP_201_CREATED)
async def add_holding(body: dict = Body(...), current_user: CurrentUser = None) -> dict:  # type: ignore[assignment]
    from app.infra.db.repositories.holdings_repo import HoldingsRepository
    symbol: str = body.get("symbol", "").upper().strip()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol required")
    if not symbol.endswith((".NS", ".BO")):
        symbol = symbol + ".NS"
    qty = int(body.get("qty", 0))
    avg_price = float(body.get("avg_price", 0))
    if qty <= 0 or avg_price <= 0:
        raise HTTPException(status_code=400, detail="qty and avg_price must be positive")
    name: str = body.get("name", symbol.replace(".NS", "").replace(".BO", ""))
    buy_date: str | None = body.get("buy_date")
    sector: str = body.get("sector") or _SECTOR_MAP.get(symbol, "Other")
    repo = HoldingsRepository()
    result = await repo.add_holding(str(current_user.id), symbol, name, qty, avg_price, buy_date, sector)
    if not result:
        raise HTTPException(status_code=500, detail="Failed to add holding")
    return result


@router.put("/holdings/{holding_id}")
async def update_holding(
    holding_id: str,
    body: dict = Body(...),
    current_user: CurrentUser = None,  # type: ignore[assignment]
) -> dict:
    from app.infra.db.repositories.holdings_repo import HoldingsRepository
    qty = int(body.get("qty", 0))
    avg_price = float(body.get("avg_price", 0))
    if qty <= 0 or avg_price <= 0:
        raise HTTPException(status_code=400, detail="qty and avg_price must be positive")
    repo = HoldingsRepository()
    ok = await repo.update_holding(str(current_user.id), holding_id, qty, avg_price)
    if not ok:
        raise HTTPException(status_code=404, detail="Holding not found")
    return {"ok": True}


@router.delete("/holdings/{holding_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_holding(holding_id: str, current_user: CurrentUser = None) -> None:  # type: ignore[assignment]
    from app.infra.db.repositories.holdings_repo import HoldingsRepository
    repo = HoldingsRepository()
    ok = await repo.delete_holding(str(current_user.id), holding_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Holding not found")


@router.post("/holdings/import")
async def import_holdings(body: dict = Body(...), current_user: CurrentUser = None) -> dict:  # type: ignore[assignment]
    """Bulk-replace holdings from a parsed CSV payload."""
    from app.infra.db.repositories.holdings_repo import HoldingsRepository
    rows: list[dict] = body.get("rows", [])
    if not rows:
        raise HTTPException(status_code=400, detail="No rows provided")
    sanitized = []
    for r in rows:
        sym = str(r.get("symbol", "")).upper().strip()
        if not sym:
            continue
        if not sym.endswith((".NS", ".BO")):
            sym += ".NS"
        try:
            qty = int(r.get("qty", 0))
            avg_price = float(r.get("avg_price", 0))
        except (TypeError, ValueError):
            continue
        if qty <= 0 or avg_price <= 0:
            continue
        sanitized.append({
            "symbol": sym,
            "name": r.get("name", sym.replace(".NS", "").replace(".BO", "")),
            "qty": qty,
            "avg_price": avg_price,
            "buy_date": r.get("buy_date"),
            "sector": r.get("sector") or _SECTOR_MAP.get(sym, "Other"),
        })
    repo = HoldingsRepository()
    n = await repo.bulk_upsert(str(current_user.id), sanitized)
    return {"imported": n}


# ── Portfolio Assistant — Analysis ────────────────────────────────────────────

@router.get("/assistant/analysis")
async def assistant_analysis(current_user: CurrentUser) -> dict:
    """Full enriched analysis of the user's real holdings."""
    from app.infra.db.repositories.holdings_repo import HoldingsRepository
    from app.infra.db.repositories.discovery_repo import DiscoveryRepository
    from app.infra.market_data.yfinance_client import YFinanceClient

    h_repo = HoldingsRepository()
    d_repo = DiscoveryRepository()
    holdings = await h_repo.list_holdings(str(current_user.id))

    if not holdings:
        return {
            "holdings": [], "summary": _empty_summary(),
            "sector_allocation": {}, "alerts": [],
            "risk": {}, "performance": {}, "recommendations": [],
        }

    client = YFinanceClient()
    symbols = [h["symbol"] for h in holdings]
    quotes = await asyncio.gather(*[client.get_quote(s) for s in symbols], return_exceptions=True)
    price_map: dict[str, float] = {}
    for sym, q in zip(symbols, quotes):
        if not isinstance(q, Exception) and q is not None:
            price_map[sym] = q.price

    # Fetch latest discovery scores for each symbol
    score_tasks = [d_repo.get_scores_for_symbol(s, limit=1) for s in symbols]
    score_results = await asyncio.gather(*score_tasks, return_exceptions=True)
    score_map: dict[str, object] = {}
    for sym, res in zip(symbols, score_results):
        if not isinstance(res, Exception) and res:
            score_map[sym] = res[0]

    enriched: list[dict] = []
    sector_alloc: dict[str, float] = {}
    alerts: list[dict] = []
    total_invested = 0.0
    total_current = 0.0

    for h in holdings:
        sym = h["symbol"]
        ap = h["avg_price"]
        qty = h["qty"]
        cp = price_map.get(sym, ap)
        invested = qty * ap
        current_val = qty * cp
        pnl = current_val - invested
        pnl_pct = pnl / invested * 100 if invested else 0.0
        sc = score_map.get(sym)

        # Recommendation
        if pnl_pct >= 20 and sc and getattr(sc, "signal", "") in ("SELL", "STRONG_SELL"):
            rec, rec_reason = "SELL", f"Up {pnl_pct:.1f}% — AI signal {getattr(sc, 'signal', '')}, book profits"
        elif pnl_pct <= -12:
            rec, rec_reason = "REVIEW", f"Down {abs(pnl_pct):.1f}% — re-evaluate thesis or cut loss"
        elif sc and getattr(sc, "signal", "") in ("STRONG_BUY",) and pnl_pct > -5:
            rec, rec_reason = "ADD", f"AI STRONG BUY (score {getattr(sc, 'score', 0):.0f}) — consider adding"
        elif sc and getattr(sc, "signal", "") in ("BUY", "STRONG_BUY"):
            rec, rec_reason = "HOLD", f"AI bullish ({getattr(sc, 'signal', '')}) — maintain position"
        elif sc and getattr(sc, "signal", "") in ("SELL", "STRONG_SELL") and pnl_pct < 0:
            rec, rec_reason = "SELL", f"AI bearish + position at loss — exit to limit downside"
        else:
            rec, rec_reason = "HOLD", "No strong signal — continue holding and monitor"

        # Alerts
        sym_clean = sym.replace(".NS", "").replace(".BO", "")
        if pnl_pct <= -10:
            alerts.append({"symbol": sym_clean, "type": "LOSS", "severity": "high",
                           "message": f"{sym_clean} down {abs(pnl_pct):.1f}% — review stop loss"})
        elif pnl_pct <= -5:
            alerts.append({"symbol": sym_clean, "type": "LOSS", "severity": "medium",
                           "message": f"{sym_clean} down {abs(pnl_pct):.1f}% — monitor closely"})
        if pnl_pct >= 20 and sc and getattr(sc, "signal", "") in ("SELL", "STRONG_SELL"):
            alerts.append({"symbol": sym_clean, "type": "TARGET", "severity": "medium",
                           "message": f"{sym_clean} up {pnl_pct:.1f}% — AI suggests booking profits"})

        sector = h.get("sector", "Other")
        sector_alloc[sector] = round(sector_alloc.get(sector, 0.0) + current_val, 2)
        total_invested += invested
        total_current += current_val

        enriched.append({
            "id": h["id"],
            "symbol": sym,
            "name": h.get("name", sym_clean),
            "qty": qty,
            "avg_price": round(ap, 2),
            "current_price": round(cp, 2),
            "invested": round(invested, 2),
            "current_value": round(current_val, 2),
            "pnl": round(pnl, 2),
            "pnl_pct": round(pnl_pct, 2),
            "sector": sector,
            "recommendation": rec,
            "rec_reason": rec_reason,
            "ai_score": round(getattr(sc, "score", 0), 1) if sc else None,
            "ai_signal": getattr(sc, "signal", None) if sc else None,
            "ai_confidence": round(getattr(sc, "confidence", 0), 2) if sc else None,
            "ai_stop_loss": getattr(sc, "stop_loss", None) if sc else None,
            "ai_targets": getattr(sc, "targets", []) if sc else [],
            "buy_date": h.get("buy_date"),
        })

    enriched.sort(key=lambda x: x["pnl_pct"])
    total_pnl = total_current - total_invested
    total_pnl_pct = total_pnl / total_invested * 100 if total_invested else 0.0
    winners = sum(1 for h in enriched if h["pnl"] > 0)
    losers = len(enriched) - winners
    win_rate = winners / len(enriched) * 100 if enriched else 0.0

    # Diversification score (0–100)
    n_sectors = len(sector_alloc)
    max_wt = max(v / total_current for v in sector_alloc.values()) if sector_alloc and total_current else 1.0
    div_score = min(100.0, n_sectors * 12 * (1.2 - max_wt))

    # Portfolio health score
    ai_avg = (sum(h["ai_score"] for h in enriched if h["ai_score"]) /
               max(1, sum(1 for h in enriched if h["ai_score"])))
    health = min(100.0, max(0.0,
        div_score * 0.25 +
        win_rate * 0.25 +
        min(100, max(0, 50 + total_pnl_pct * 2)) * 0.30 +
        (ai_avg if ai_avg else 50) * 0.20
    ))

    # Position sizing (flag over-concentrated positions)
    sizing: list[dict] = []
    for h in enriched:
        wt = h["current_value"] / total_current * 100 if total_current else 0
        flag = "OVERWEIGHT" if wt > 20 else ("UNDERWEIGHT" if wt < 2 else "OK")
        sizing.append({"symbol": h["symbol"].replace(".NS", "").replace(".BO", ""),
                       "weight_pct": round(wt, 1), "flag": flag,
                       "invested": h["invested"]})

    # Risk metrics
    pnl_pcts = [h["pnl_pct"] for h in enriched]
    worst = min(pnl_pcts) if pnl_pcts else 0
    best  = max(pnl_pcts) if pnl_pcts else 0
    avg_pnl_pct = sum(pnl_pcts) / len(pnl_pcts) if pnl_pcts else 0
    # Approximate portfolio volatility (spread of returns)
    variance = sum((p - avg_pnl_pct) ** 2 for p in pnl_pcts) / len(pnl_pcts) if pnl_pcts else 0
    vol = variance ** 0.5
    risk_level = "High" if vol > 12 or worst < -15 else "Medium" if vol > 6 or worst < -8 else "Low"

    return {
        "holdings": enriched,
        "summary": {
            "total_invested": round(total_invested, 2),
            "current_value": round(total_current, 2),
            "total_pnl": round(total_pnl, 2),
            "total_pnl_pct": round(total_pnl_pct, 2),
            "holdings_count": len(enriched),
            "winners": winners,
            "losers": losers,
            "win_rate": round(win_rate, 1),
            "health_score": round(health, 1),
            "diversification_score": round(div_score, 1),
        },
        "sector_allocation": {k: round(v, 2) for k, v in sorted(sector_alloc.items(), key=lambda x: -x[1])},
        "alerts": sorted(alerts, key=lambda a: a["severity"] == "high", reverse=True)[:10],
        "risk": {
            "level": risk_level,
            "worst_position_pct": round(worst, 2),
            "best_position_pct": round(best, 2),
            "portfolio_volatility": round(vol, 2),
            "concentration_risk": round(max_wt * 100, 1),
        },
        "sizing": sizing,
    }


def _empty_summary() -> dict:
    return {
        "total_invested": 0, "current_value": 0, "total_pnl": 0, "total_pnl_pct": 0,
        "holdings_count": 0, "winners": 0, "losers": 0, "win_rate": 0,
        "health_score": 0, "diversification_score": 0,
    }


# ── Portfolio Assistant — Chat ────────────────────────────────────────────────

@router.post("/assistant/chat")
async def assistant_chat(
    body: dict = Body(...),
    current_user: CurrentUser = None,  # type: ignore[assignment]
) -> dict:
    """Rule-based AI answers grounded in the user's actual portfolio data."""
    from app.infra.db.repositories.holdings_repo import HoldingsRepository
    from app.infra.db.repositories.discovery_repo import DiscoveryRepository
    from app.infra.market_data.yfinance_client import YFinanceClient

    question: str = body.get("question", "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="question required")

    # Fetch live analysis (reuse the analysis endpoint logic inline)
    h_repo = HoldingsRepository()
    d_repo = DiscoveryRepository()
    holdings = await h_repo.list_holdings(str(current_user.id))

    if not holdings:
        return {"answer": "Your portfolio is empty. Add some holdings first using the '+' button above.", "sources": []}

    client = YFinanceClient()
    symbols = [h["symbol"] for h in holdings]
    quotes = await asyncio.gather(*[client.get_quote(s) for s in symbols], return_exceptions=True)
    price_map: dict[str, float] = {
        sym: q.price
        for sym, q in zip(symbols, quotes)
        if not isinstance(q, Exception) and q is not None
    }
    score_tasks = [d_repo.get_scores_for_symbol(s, limit=1) for s in symbols]
    score_results = await asyncio.gather(*score_tasks, return_exceptions=True)
    score_map = {sym: res[0] for sym, res in zip(symbols, score_results)
                 if not isinstance(res, Exception) and res}

    enriched = []
    total_invested = 0.0
    total_current = 0.0
    sector_alloc: dict[str, float] = {}
    for h in holdings:
        sym = h["symbol"]
        cp = price_map.get(sym, h["avg_price"])
        invested = h["qty"] * h["avg_price"]
        current_val = h["qty"] * cp
        pnl_pct = (current_val - invested) / invested * 100 if invested else 0
        sc = score_map.get(sym)
        sector = h.get("sector", "Other")
        sector_alloc[sector] = sector_alloc.get(sector, 0.0) + current_val
        total_invested += invested
        total_current += current_val
        enriched.append({
            "symbol": sym.replace(".NS", "").replace(".BO", ""),
            "name": h.get("name", sym),
            "qty": h["qty"],
            "avg_price": h["avg_price"],
            "current_price": cp,
            "invested": invested,
            "current_value": current_val,
            "pnl_pct": round(pnl_pct, 2),
            "sector": sector,
            "ai_score": getattr(sc, "score", None) if sc else None,
            "ai_signal": getattr(sc, "signal", None) if sc else None,
        })

    enriched.sort(key=lambda x: x["pnl_pct"])
    total_pnl_pct = (total_current - total_invested) / total_invested * 100 if total_invested else 0
    n_sectors = len(sector_alloc)
    max_wt = max(v / total_current for v in sector_alloc.values()) if sector_alloc and total_current else 1.0
    worst = enriched[0] if enriched else None
    best  = enriched[-1] if enriched else None

    q = question.lower()
    answer = _generate_answer(q, enriched, total_pnl_pct, sector_alloc, n_sectors, max_wt, worst, best, total_invested, total_current)
    return {"answer": answer, "sources": [h["symbol"] for h in enriched[:5]]}


def _generate_answer(
    q: str,
    enriched: list[dict],
    total_pnl_pct: float,
    sector_alloc: dict,
    n_sectors: int,
    max_wt: float,
    worst: dict | None,
    best: dict | None,
    total_invested: float,
    total_current: float,
) -> str:
    losers = [h for h in enriched if h["pnl_pct"] < 0]
    winners = [h for h in enriched if h["pnl_pct"] > 0]
    sell_signals = [h for h in enriched if h.get("ai_signal") in ("SELL", "STRONG_SELL")]
    strong_buy = [h for h in enriched if h.get("ai_signal") == "STRONG_BUY"]
    dominant_sector = max(sector_alloc, key=sector_alloc.get) if sector_alloc else "Unknown"
    dominant_pct = sector_alloc.get(dominant_sector, 0) / total_current * 100 if total_current else 0

    # Underperformance
    if any(k in q for k in ("underperform", "why is my", "performing poorly", "doing badly")):
        if total_pnl_pct >= 0:
            return (f"Your portfolio is actually up {total_pnl_pct:.1f}% overall — it is not underperforming. "
                    f"However, {len(losers)} out of {len(enriched)} holdings are in the red. "
                    + (f"The biggest drag is **{losers[0]['symbol']}** ({losers[0]['pnl_pct']:+.1f}%)." if losers else ""))
        drag = ", ".join(f"{h['symbol']} ({h['pnl_pct']:+.1f}%)" for h in losers[:3])
        sector_note = f" Your portfolio is {dominant_pct:.0f}% concentrated in {dominant_sector}, which may be underperforming the broader market." if dominant_pct > 40 else ""
        return (f"Your portfolio is down {abs(total_pnl_pct):.1f}%. "
                f"The main drag comes from {drag}.{sector_note} "
                f"Consider reviewing positions that are down more than 10% and checking if the original thesis still holds.")

    # Riskiest holding
    if any(k in q for k in ("riskiest", "most risk", "highest risk", "risky")):
        pnl_sorted = sorted(enriched, key=lambda x: x["pnl_pct"])
        riskiest = pnl_sorted[0] if pnl_sorted else None
        if not riskiest:
            return "Add holdings to get risk analysis."
        overconc = [h for h in enriched if h["current_value"] / total_current * 100 > 20] if total_current else []
        parts = [f"**{riskiest['symbol']}** is currently your worst performer at {riskiest['pnl_pct']:+.1f}%."]
        if overconc:
            parts.append(f"**{overconc[0]['symbol']}** is over-concentrated at {overconc[0]['current_value']/total_current*100:.0f}% of the portfolio — concentration is a risk even for winning positions.")
        if sell_signals:
            parts.append(f"AI signals a SELL on {', '.join(h['symbol'] for h in sell_signals[:2])}, indicating downside risk.")
        return " ".join(parts)

    # What to sell first
    if any(k in q for k in ("sell first", "sell", "exit", "book profit", "book loss")):
        candidates = sorted(
            [h for h in enriched if h.get("ai_signal") in ("SELL", "STRONG_SELL") or h["pnl_pct"] < -10],
            key=lambda x: x["pnl_pct"]
        )
        if not candidates:
            big_winners = [h for h in enriched if h["pnl_pct"] > 20]
            if big_winners:
                sym = big_winners[-1]["symbol"]
                return (f"No clear sell signals or major losers. Consider booking partial profits in **{sym}** "
                        f"(up {big_winners[-1]['pnl_pct']:+.1f}%) — locking in gains de-risks the portfolio.")
            return "No strong sell signals right now. Continue holding and monitoring your positions."
        top = candidates[0]
        reason = "AI bearish signal" if top.get("ai_signal") in ("SELL", "STRONG_SELL") else f"down {abs(top['pnl_pct']):.1f}%"
        return (f"Consider exiting **{top['symbol']}** first ({reason}). "
                + (f"Also review {', '.join(h['symbol'] for h in candidates[1:3])}." if len(candidates) > 1 else ""))

    # Where to invest
    if any(k in q for k in ("invest", "₹", "lakh", "where should", "buy", "add")):
        budget_note = "₹1 lakh"
        if strong_buy:
            top3 = strong_buy[:3]
            alloc = 100_000 / len(top3)
            suggestions = ", ".join(
                f"**{h['symbol']}** (AI score {h['ai_score']:.0f}, ₹{alloc:,.0f})" for h in top3 if h['ai_score']
            )
            return (f"Based on current AI signals, consider splitting {budget_note} across: {suggestions}. "
                    f"These have STRONG BUY ratings from the discovery engine. "
                    f"Apply your own risk management — never deploy all capital in one go; consider 2–3 tranches.")
        if winners:
            sym = winners[-1]["symbol"]
            return (f"No STRONG BUY signals available right now. If you want to add to an existing position, "
                    f"**{sym}** (+{winners[-1]['pnl_pct']:.1f}%) is your best performer and momentum favors it. "
                    f"Alternatively, wait for the next Discovery scan (runs every 5 min during market hours) for fresh signals.")
        return ("Market signals are mixed right now. Consider waiting for a clearer setup. "
                "Check the Discovery page for the latest top picks before deploying capital.")

    # Diversification
    if any(k in q for k in ("diversif", "concentrated", "sector", "spread")):
        if n_sectors <= 2:
            return (f"Your portfolio is poorly diversified — only {n_sectors} sector(s). "
                    f"{dominant_pct:.0f}% is in {dominant_sector}. "
                    f"Aim for at least 4–5 sectors. Consider adding stocks from Banking, IT, FMCG, or Pharma to balance.")
        if dominant_pct > 40:
            return (f"Your largest sector is **{dominant_sector}** at {dominant_pct:.0f}% of the portfolio — that is concentrated. "
                    f"A healthy allocation keeps any single sector below 30–35%. "
                    f"Consider trimming {dominant_sector} exposure and spreading into under-represented sectors.")
        return (f"Your portfolio spans {n_sectors} sectors — reasonable diversification. "
                f"The largest is {dominant_sector} at {dominant_pct:.0f}%. "
                f"{'Good balance.' if dominant_pct < 30 else 'Slightly top-heavy — monitor.'}")

    # Downside risk
    if any(k in q for k in ("downside", "downside risk", "worst case", "drawdown", "lose")):
        at_risk = [h for h in enriched if h["pnl_pct"] < -5]
        total_at_risk = sum(h["invested"] for h in at_risk)
        pct_at_risk = total_at_risk / total_invested * 100 if total_invested else 0
        if not at_risk:
            return (f"All your positions are currently in profit. "
                    f"The main downside risk is giving back gains — watch positions up >20% without strong AI backing.")
        sym_list = ", ".join(f"{h['symbol']} ({h['pnl_pct']:+.1f}%)" for h in at_risk[:4])
        return (f"{len(at_risk)} position(s) have meaningful downside: {sym_list}. "
                f"These represent ₹{total_at_risk:,.0f} ({pct_at_risk:.0f}% of invested capital). "
                f"Set stop-losses at 8–10% below entry for any position you haven't already protected.")

    # Expected return
    if any(k in q for k in ("expected return", "return", "6 month", "target", "predict")):
        ai_bullish = [h for h in enriched if h.get("ai_signal") in ("BUY", "STRONG_BUY")]
        avg_target_upside = 12.0  # simplified estimate
        if ai_bullish:
            return (f"{len(ai_bullish)} of your holdings ({', '.join(h['symbol'] for h in ai_bullish[:3])}) "
                    f"carry bullish AI signals. Based on typical 3–6 month targets from the discovery engine, "
                    f"upside of 8–15% is plausible for these positions if the thesis holds. "
                    f"Your overall portfolio is currently at {total_pnl_pct:+.1f}%. "
                    f"Past AI signal performance: see the Reports page for historical accuracy data. "
                    f"This is not a guarantee — apply stop-losses.")
        return (f"Your portfolio is at {total_pnl_pct:+.1f}% overall. "
                f"Without clear bullish AI signals, expected return over 6 months is uncertain. "
                f"Run a fresh Discovery scan for updated signals and recalibrate.")

    # Default: portfolio summary
    total_pnl = total_current - total_invested
    return (f"Your portfolio of {len(enriched)} holdings is {'up' if total_pnl >= 0 else 'down'} "
            f"₹{abs(total_pnl):,.0f} ({total_pnl_pct:+.1f}%). "
            f"{len(winners)} winners, {len(losers)} losers. "
            + (f"Best: {best['symbol']} ({best['pnl_pct']:+.1f}%). " if best else "")
            + (f"Worst: {worst['symbol']} ({worst['pnl_pct']:+.1f}%). " if worst else "")
            + "Ask me something specific — 'Which should I sell?', 'Where should I invest ₹1 lakh?', 'Am I diversified?'")
