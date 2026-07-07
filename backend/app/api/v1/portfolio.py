"""Portfolio P&L summary — open positions with live prices + closed trade history.

Also hosts the Portfolio Assistant endpoints (/portfolio/holdings/* and
/portfolio/assistant/*) for tracking real brokerage holdings with AI analysis.
"""

import asyncio
from datetime import datetime

from fastapi import APIRouter, Body, HTTPException, status
from fastapi import Query as QParam

from app.api.deps import CurrentUser, MarketDataDep, TradeDep
from app.domain.models.trade import TradeSignal, TradeStatus
from app.infra.scanner.universe import SECTORS

_SYMBOL_SECTOR: dict[str, str] = {sym: sector for sector, syms in SECTORS.items() for sym in syms}

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
        positions.append(
            {
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
            }
        )

    # Closed trades (most recent first)
    closed_list = []
    for t in sorted(closed_trades, key=lambda x: x.closed_at or datetime.min, reverse=True):
        invested = round(t.entry_price * t.quantity, 2)
        pnl = t.pnl or 0.0
        pnl_pct = round(pnl / invested * 100, 2) if invested else 0.0
        ref_open = t.opened_at or t.created_at
        days = (t.closed_at - ref_open).days if t.closed_at else 0
        closed_list.append(
            {
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
            }
        )

    # Equity curve — cumulative realized P&L ordered by close date
    equity_curve: list[dict] = []
    sorted_closed = sorted(
        [t for t in closed_trades if t.closed_at],
        key=lambda x: x.closed_at,  # type: ignore[arg-type]
    )
    cum = 0.0
    for t in sorted_closed:
        cum += t.pnl or 0.0
        equity_curve.append(
            {
                "time": int(t.closed_at.timestamp()),  # type: ignore[union-attr]
                "value": round(cum, 2),
            }
        )

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

_SECTOR_MAP: dict[str, str] = {sym: sector for sector, syms in SECTORS.items() for sym in syms}

# ── Portfolios CRUD ────────────────────────────────────────────────────────────


@router.get("/holdings/portfolios")
async def list_portfolios(current_user: CurrentUser) -> list[dict]:
    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    repo = HoldingsRepository()
    return await repo.list_portfolios(str(current_user.id))


@router.post("/holdings/portfolios", status_code=status.HTTP_201_CREATED)
async def create_portfolio(
    body: dict = Body(...),
    current_user: CurrentUser = None,  # type: ignore[assignment]
) -> dict:
    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    name: str = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    repo = HoldingsRepository()
    return await repo.create_portfolio(str(current_user.id), name)


@router.patch("/holdings/portfolios/{portfolio_id}")
async def rename_portfolio(
    portfolio_id: str,
    body: dict = Body(...),
    current_user: CurrentUser = None,  # type: ignore[assignment]
) -> dict:
    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    name: str = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    repo = HoldingsRepository()
    ok = await repo.rename_portfolio(str(current_user.id), portfolio_id, name)
    if not ok:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return {"ok": True}


@router.delete("/holdings/portfolios/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_portfolio(
    portfolio_id: str,
    current_user: CurrentUser = None,  # type: ignore[assignment]
) -> None:
    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    repo = HoldingsRepository()
    await repo.delete_portfolio(str(current_user.id), portfolio_id)


# ── Holdings CRUD ──────────────────────────────────────────────────────────────


@router.get("/holdings")
async def list_holdings(
    current_user: CurrentUser,
    portfolio_id: str = QParam(default="default"),
) -> list[dict]:
    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    repo = HoldingsRepository()
    return await repo.list_holdings(str(current_user.id), portfolio_id)


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
    portfolio_id: str = body.get("portfolio_id", "default")
    repo = HoldingsRepository()
    result = await repo.add_holding(
        str(current_user.id), symbol, name, qty, avg_price, buy_date, sector, portfolio_id
    )
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
    """Bulk-replace holdings for a specific portfolio from a parsed CSV payload."""
    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    rows: list[dict] = body.get("rows", [])
    portfolio_id: str = body.get("portfolio_id", "default")
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
        sanitized.append(
            {
                "symbol": sym,
                "name": r.get("name", sym.replace(".NS", "").replace(".BO", "")),
                "qty": qty,
                "avg_price": avg_price,
                "buy_date": r.get("buy_date"),
                "sector": r.get("sector") or _SECTOR_MAP.get(sym, "Other"),
            }
        )
    repo = HoldingsRepository()
    n = await repo.bulk_upsert(str(current_user.id), sanitized, portfolio_id)
    return {"imported": n}


# ── Portfolio Assistant — Analysis ────────────────────────────────────────────


@router.get("/assistant/analysis")
async def assistant_analysis(
    current_user: CurrentUser,
    portfolio_id: str = QParam(default="default"),
) -> dict:
    """Full enriched analysis of the user's real holdings."""
    from app.infra.db.repositories.discovery_repo import DiscoveryRepository
    from app.infra.db.repositories.holdings_repo import HoldingsRepository
    from app.infra.market_data.yfinance_client import YFinanceClient

    h_repo = HoldingsRepository()
    d_repo = DiscoveryRepository()
    holdings = await h_repo.list_holdings(str(current_user.id), portfolio_id)

    if not holdings:
        return {
            "holdings": [],
            "summary": _empty_summary(),
            "sector_allocation": {},
            "alerts": [],
            "risk": {},
            "performance": {},
            "recommendations": [],
        }

    client = YFinanceClient()
    symbols = [h["symbol"] for h in holdings]
    quotes = await asyncio.gather(*[client.get_quote(s) for s in symbols], return_exceptions=True)
    price_map: dict[str, float] = {}
    for sym, q in zip(symbols, quotes, strict=True):
        if not isinstance(q, Exception) and q is not None:
            price_map[sym] = q.price

    # Fetch latest discovery scores for each symbol
    score_tasks = [d_repo.get_scores_for_symbol(s, limit=1) for s in symbols]
    score_results = await asyncio.gather(*score_tasks, return_exceptions=True)
    score_map: dict[str, object] = {}
    for sym, res in zip(symbols, score_results, strict=True):
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
            rec, rec_reason = (
                "SELL",
                f"Up {pnl_pct:.1f}% — AI signal {getattr(sc, 'signal', '')}, book profits",
            )
        elif pnl_pct <= -12:
            rec, rec_reason = "REVIEW", f"Down {abs(pnl_pct):.1f}% — re-evaluate thesis or cut loss"
        elif sc and getattr(sc, "signal", "") in ("STRONG_BUY",) and pnl_pct > -5:
            rec, rec_reason = (
                "ADD",
                f"AI STRONG BUY (score {getattr(sc, 'score', 0):.0f}) — consider adding",
            )
        elif sc and getattr(sc, "signal", "") in ("BUY", "STRONG_BUY"):
            rec, rec_reason = (
                "HOLD",
                f"AI bullish ({getattr(sc, 'signal', '')}) — maintain position",
            )
        elif sc and getattr(sc, "signal", "") in ("SELL", "STRONG_SELL") and pnl_pct < 0:
            rec, rec_reason = "SELL", "AI bearish + position at loss — exit to limit downside"
        else:
            rec, rec_reason = "HOLD", "No strong signal — continue holding and monitor"

        # Alerts
        sym_clean = sym.replace(".NS", "").replace(".BO", "")
        if pnl_pct <= -10:
            alerts.append(
                {
                    "symbol": sym_clean,
                    "type": "LOSS",
                    "severity": "high",
                    "message": f"{sym_clean} down {abs(pnl_pct):.1f}% — review stop loss",
                }
            )
        elif pnl_pct <= -5:
            alerts.append(
                {
                    "symbol": sym_clean,
                    "type": "LOSS",
                    "severity": "medium",
                    "message": f"{sym_clean} down {abs(pnl_pct):.1f}% — monitor closely",
                }
            )
        if pnl_pct >= 20 and sc and getattr(sc, "signal", "") in ("SELL", "STRONG_SELL"):
            alerts.append(
                {
                    "symbol": sym_clean,
                    "type": "TARGET",
                    "severity": "medium",
                    "message": f"{sym_clean} up {pnl_pct:.1f}% — AI suggests booking profits",
                }
            )

        sector = h.get("sector", "Other")
        sector_alloc[sector] = round(sector_alloc.get(sector, 0.0) + current_val, 2)
        total_invested += invested
        total_current += current_val

        enriched.append(
            {
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
            }
        )

    enriched.sort(key=lambda x: x["pnl_pct"])
    total_pnl = total_current - total_invested
    total_pnl_pct = total_pnl / total_invested * 100 if total_invested else 0.0
    winners = sum(1 for h in enriched if h["pnl"] > 0)
    losers = len(enriched) - winners
    win_rate = winners / len(enriched) * 100 if enriched else 0.0

    # Diversification score (0–100)
    n_sectors = len(sector_alloc)
    max_wt = (
        max(v / total_current for v in sector_alloc.values())
        if sector_alloc and total_current
        else 1.0
    )
    div_score = min(100.0, n_sectors * 12 * (1.2 - max_wt))

    # Portfolio health score
    ai_avg = sum(h["ai_score"] for h in enriched if h["ai_score"]) / max(
        1, sum(1 for h in enriched if h["ai_score"])
    )
    health = min(
        100.0,
        max(
            0.0,
            div_score * 0.25
            + win_rate * 0.25
            + min(100, max(0, 50 + total_pnl_pct * 2)) * 0.30
            + (ai_avg if ai_avg else 50) * 0.20,
        ),
    )

    # Position sizing (flag over-concentrated positions)
    sizing: list[dict] = []
    for h in enriched:
        wt = h["current_value"] / total_current * 100 if total_current else 0
        flag = "OVERWEIGHT" if wt > 20 else ("UNDERWEIGHT" if wt < 2 else "OK")
        sizing.append(
            {
                "symbol": h["symbol"].replace(".NS", "").replace(".BO", ""),
                "weight_pct": round(wt, 1),
                "flag": flag,
                "invested": h["invested"],
            }
        )

    # Risk metrics
    pnl_pcts = [h["pnl_pct"] for h in enriched]
    worst = min(pnl_pcts) if pnl_pcts else 0
    best = max(pnl_pcts) if pnl_pcts else 0
    avg_pnl_pct = sum(pnl_pcts) / len(pnl_pcts) if pnl_pcts else 0
    # Approximate portfolio volatility (spread of returns)
    variance = sum((p - avg_pnl_pct) ** 2 for p in pnl_pcts) / len(pnl_pcts) if pnl_pcts else 0
    vol = variance**0.5
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
        "sector_allocation": {
            k: round(v, 2) for k, v in sorted(sector_alloc.items(), key=lambda x: -x[1])
        },
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
        "total_invested": 0,
        "current_value": 0,
        "total_pnl": 0,
        "total_pnl_pct": 0,
        "holdings_count": 0,
        "winners": 0,
        "losers": 0,
        "win_rate": 0,
        "health_score": 0,
        "diversification_score": 0,
    }


# ── Portfolio Assistant — Chat ────────────────────────────────────────────────


@router.post("/assistant/chat")
async def assistant_chat(
    body: dict = Body(...),
    current_user: CurrentUser = None,  # type: ignore[assignment]
) -> dict:
    """Rule-based AI answers grounded in the user's actual portfolio data."""
    from app.infra.db.repositories.discovery_repo import DiscoveryRepository
    from app.infra.db.repositories.holdings_repo import HoldingsRepository
    from app.infra.market_data.yfinance_client import YFinanceClient

    question: str = body.get("question", "").strip()
    portfolio_id: str = body.get("portfolio_id", "default")
    if not question:
        raise HTTPException(status_code=400, detail="question required")

    # Fetch live analysis (reuse the analysis endpoint logic inline)
    h_repo = HoldingsRepository()
    d_repo = DiscoveryRepository()
    holdings = await h_repo.list_holdings(str(current_user.id), portfolio_id)

    if not holdings:
        return {
            "answer": (
                "Your portfolio is empty. Add some holdings first using the '+' button above."
            ),
            "sources": [],
        }

    client = YFinanceClient()
    symbols = [h["symbol"] for h in holdings]
    quotes = await asyncio.gather(*[client.get_quote(s) for s in symbols], return_exceptions=True)
    price_map: dict[str, float] = {
        sym: q.price
        for sym, q in zip(symbols, quotes, strict=True)
        if not isinstance(q, Exception) and q is not None
    }
    score_tasks = [d_repo.get_scores_for_symbol(s, limit=1) for s in symbols]
    score_results = await asyncio.gather(*score_tasks, return_exceptions=True)
    score_map = {
        sym: res[0]
        for sym, res in zip(symbols, score_results, strict=True)
        if not isinstance(res, Exception) and res
    }

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
        enriched.append(
            {
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
            }
        )

    enriched.sort(key=lambda x: x["pnl_pct"])
    total_pnl_pct = (total_current - total_invested) / total_invested * 100 if total_invested else 0
    n_sectors = len(sector_alloc)
    max_wt = (
        max(v / total_current for v in sector_alloc.values())
        if sector_alloc and total_current
        else 1.0
    )
    worst = enriched[0] if enriched else None
    best = enriched[-1] if enriched else None

    q = question.lower()
    answer = _generate_answer(
        q,
        enriched,
        total_pnl_pct,
        sector_alloc,
        n_sectors,
        max_wt,
        worst,
        best,
        total_invested,
        total_current,
    )
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
    dominant_pct = (
        sector_alloc.get(dominant_sector, 0) / total_current * 100 if total_current else 0
    )

    # Underperformance
    if any(k in q for k in ("underperform", "why is my", "performing poorly", "doing badly")):
        if total_pnl_pct >= 0:
            return (
                f"Your portfolio is actually up {total_pnl_pct:.1f}% overall — "
                f"it is not underperforming. "
                f"However, {len(losers)} out of {len(enriched)} holdings are in the red. "
                + (
                    f"The biggest drag is **{losers[0]['symbol']}** ({losers[0]['pnl_pct']:+.1f}%)."
                    if losers
                    else ""
                )
            )
        drag = ", ".join(f"{h['symbol']} ({h['pnl_pct']:+.1f}%)" for h in losers[:3])
        sector_note = (
            f" Your portfolio is {dominant_pct:.0f}% concentrated in {dominant_sector}, "
            f"which may be underperforming the broader market."
            if dominant_pct > 40
            else ""
        )
        return (
            f"Your portfolio is down {abs(total_pnl_pct):.1f}%. "
            f"The main drag comes from {drag}.{sector_note} "
            f"Consider reviewing positions that are down more than 10% and checking "
            f"if the original thesis still holds."
        )

    # Riskiest holding
    if any(k in q for k in ("riskiest", "most risk", "highest risk", "risky")):
        pnl_sorted = sorted(enriched, key=lambda x: x["pnl_pct"])
        riskiest = pnl_sorted[0] if pnl_sorted else None
        if not riskiest:
            return "Add holdings to get risk analysis."
        overconc = (
            [h for h in enriched if h["current_value"] / total_current * 100 > 20]
            if total_current
            else []
        )
        parts = [
            f"**{riskiest['symbol']}** is currently your worst performer "
            f"at {riskiest['pnl_pct']:+.1f}%."
        ]
        if overconc:
            overconc_pct = overconc[0]["current_value"] / total_current * 100
            parts.append(
                f"**{overconc[0]['symbol']}** is over-concentrated at {overconc_pct:.0f}% "
                f"of the portfolio — concentration is a risk even for winning positions."
            )
        if sell_signals:
            parts.append(
                f"AI signals a SELL on {', '.join(h['symbol'] for h in sell_signals[:2])}, "
                f"indicating downside risk."
            )
        return " ".join(parts)

    # What to sell first
    if any(k in q for k in ("sell first", "sell", "exit", "book profit", "book loss")):
        candidates = sorted(
            [
                h
                for h in enriched
                if h.get("ai_signal") in ("SELL", "STRONG_SELL") or h["pnl_pct"] < -10
            ],
            key=lambda x: x["pnl_pct"],
        )
        if not candidates:
            big_winners = [h for h in enriched if h["pnl_pct"] > 20]
            if big_winners:
                sym = big_winners[-1]["symbol"]
                return (
                    f"No clear sell signals or major losers. Consider booking partial "
                    f"profits in **{sym}** "
                    f"(up {big_winners[-1]['pnl_pct']:+.1f}%) — locking in gains de-risks "
                    f"the portfolio."
                )
            return (
                "No strong sell signals right now. Continue holding and monitoring your positions."
            )
        top = candidates[0]
        reason = (
            "AI bearish signal"
            if top.get("ai_signal") in ("SELL", "STRONG_SELL")
            else f"down {abs(top['pnl_pct']):.1f}%"
        )
        return f"Consider exiting **{top['symbol']}** first ({reason}). " + (
            f"Also review {', '.join(h['symbol'] for h in candidates[1:3])}."
            if len(candidates) > 1
            else ""
        )

    # Where to invest
    if any(k in q for k in ("invest", "₹", "lakh", "where should", "buy", "add")):
        budget_note = "₹1 lakh"
        if strong_buy:
            top3 = strong_buy[:3]
            alloc = 100_000 / len(top3)
            suggestions = ", ".join(
                f"**{h['symbol']}** (AI score {h['ai_score']:.0f}, ₹{alloc:,.0f})"
                for h in top3
                if h["ai_score"]
            )
            return (
                f"Based on current AI signals, consider splitting {budget_note} "
                f"across: {suggestions}. "
                f"These have STRONG BUY ratings from the discovery engine. "
                f"Apply your own risk management — never deploy all capital in one go; "
                f"consider 2–3 tranches."
            )
        if winners:
            sym = winners[-1]["symbol"]
            return (
                f"No STRONG BUY signals available right now. If you want to add to "
                f"an existing position, "
                f"**{sym}** (+{winners[-1]['pnl_pct']:.1f}%) is your best performer "
                f"and momentum favors it. "
                f"Alternatively, wait for the next Discovery scan (runs every 5 min "
                f"during market hours) for fresh signals."
            )
        return (
            "Market signals are mixed right now. Consider waiting for a clearer setup. "
            "Check the Discovery page for the latest top picks before deploying capital."
        )

    # Diversification
    if any(k in q for k in ("diversif", "concentrated", "sector", "spread")):
        if n_sectors <= 2:
            return (
                f"Your portfolio is poorly diversified — only {n_sectors} sector(s). "
                f"{dominant_pct:.0f}% is in {dominant_sector}. "
                f"Aim for at least 4–5 sectors. Consider adding stocks from Banking, "
                f"IT, FMCG, or Pharma to balance."
            )
        if dominant_pct > 40:
            return (
                f"Your largest sector is **{dominant_sector}** at {dominant_pct:.0f}% "
                f"of the portfolio — that is concentrated. "
                f"A healthy allocation keeps any single sector below 30–35%. "
                f"Consider trimming {dominant_sector} exposure and spreading into "
                f"under-represented sectors."
            )
        return (
            f"Your portfolio spans {n_sectors} sectors — reasonable diversification. "
            f"The largest is {dominant_sector} at {dominant_pct:.0f}%. "
            f"{'Good balance.' if dominant_pct < 30 else 'Slightly top-heavy — monitor.'}"
        )

    # Downside risk
    if any(k in q for k in ("downside", "downside risk", "worst case", "drawdown", "lose")):
        at_risk = [h for h in enriched if h["pnl_pct"] < -5]
        total_at_risk = sum(h["invested"] for h in at_risk)
        pct_at_risk = total_at_risk / total_invested * 100 if total_invested else 0
        if not at_risk:
            return (
                "All your positions are currently in profit. "
                "The main downside risk is giving back gains — watch positions "
                "up >20% without strong AI backing."
            )
        sym_list = ", ".join(f"{h['symbol']} ({h['pnl_pct']:+.1f}%)" for h in at_risk[:4])
        return (
            f"{len(at_risk)} position(s) have meaningful downside: {sym_list}. "
            f"These represent ₹{total_at_risk:,.0f} ({pct_at_risk:.0f}% of invested capital). "
            f"Set stop-losses at 8–10% below entry for any position you haven't already protected."
        )

    # Expected return
    if any(k in q for k in ("expected return", "return", "6 month", "target", "predict")):
        ai_bullish = [h for h in enriched if h.get("ai_signal") in ("BUY", "STRONG_BUY")]
        if ai_bullish:
            bullish_syms = ", ".join(h["symbol"] for h in ai_bullish[:3])
            return (
                f"{len(ai_bullish)} of your holdings ({bullish_syms}) "
                f"carry bullish AI signals. Based on typical 3–6 month targets "
                f"from the discovery engine, "
                f"upside of 8–15% is plausible for these positions if the thesis holds. "
                f"Your overall portfolio is currently at {total_pnl_pct:+.1f}%. "
                f"Past AI signal performance: see the Reports page for historical accuracy data. "
                f"This is not a guarantee — apply stop-losses."
            )
        return (
            f"Your portfolio is at {total_pnl_pct:+.1f}% overall. "
            f"Without clear bullish AI signals, expected return over 6 months is uncertain. "
            f"Run a fresh Discovery scan for updated signals and recalibrate."
        )

    # Default: portfolio summary
    total_pnl = total_current - total_invested
    return (
        f"Your portfolio of {len(enriched)} holdings is {'up' if total_pnl >= 0 else 'down'} "
        f"₹{abs(total_pnl):,.0f} ({total_pnl_pct:+.1f}%). "
        f"{len(winners)} winners, {len(losers)} losers. "
        + (f"Best: {best['symbol']} ({best['pnl_pct']:+.1f}%). " if best else "")
        + (f"Worst: {worst['symbol']} ({worst['pnl_pct']:+.1f}%). " if worst else "")
        + "Ask me something specific — 'Which should I sell?', "
        "'Where should I invest ₹1 lakh?', 'Am I diversified?'"
    )


# ── Portfolio Assistant — Fundamental Health ──────────────────────────────────


@router.get("/assistant/fundamentals")
async def assistant_fundamentals(
    current_user: CurrentUser,
    portfolio_id: str = QParam(default="default"),
) -> list[dict]:
    """Fetch yfinance .info for each holding: P/E, P/B, ROE, beta, market cap, etc."""
    import yfinance as yf

    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    repo = HoldingsRepository()
    holdings = await repo.list_holdings(str(current_user.id), portfolio_id)
    if not holdings:
        return []

    results = []
    for h in holdings:
        sym = h["symbol"]
        try:
            ticker = yf.Ticker(sym)
            info = ticker.info or {}
            results.append(
                {
                    "symbol": sym.replace(".NS", "").replace(".BO", ""),
                    "raw_symbol": sym,
                    "name": info.get("longName") or info.get("shortName") or sym,
                    "sector": info.get("sector") or h.get("sector", "Other"),
                    "industry": info.get("industry", "—"),
                    "market_cap": info.get("marketCap"),
                    "pe_ratio": info.get("trailingPE") or info.get("forwardPE"),
                    "pb_ratio": info.get("priceToBook"),
                    "roe": round(info.get("returnOnEquity", 0) * 100, 1)
                    if info.get("returnOnEquity")
                    else None,
                    "eps": info.get("trailingEps"),
                    "beta": round(info.get("beta", 1.0), 2) if info.get("beta") else None,
                    "dividend_yield": round(info.get("dividendYield", 0) * 100, 2)
                    if info.get("dividendYield")
                    else None,
                    "week52_high": info.get("fiftyTwoWeekHigh"),
                    "week52_low": info.get("fiftyTwoWeekLow"),
                    "current_price": info.get("currentPrice") or info.get("regularMarketPrice"),
                    "analyst_target": info.get("targetMeanPrice"),
                    "recommendation": info.get("recommendationKey", "—").replace("_", " ").title(),
                    "debt_to_equity": round(info.get("debtToEquity", 0), 2)
                    if info.get("debtToEquity")
                    else None,
                    "profit_margins": round(info.get("profitMargins", 0) * 100, 1)
                    if info.get("profitMargins")
                    else None,
                }
            )
        except Exception:
            results.append(
                {
                    "symbol": sym.replace(".NS", "").replace(".BO", ""),
                    "raw_symbol": sym,
                    "name": sym,
                    "sector": h.get("sector", "Other"),
                    "industry": "—",
                    "market_cap": None,
                    "pe_ratio": None,
                    "pb_ratio": None,
                    "roe": None,
                    "eps": None,
                    "beta": None,
                    "dividend_yield": None,
                    "week52_high": None,
                    "week52_low": None,
                    "current_price": None,
                    "analyst_target": None,
                    "recommendation": "—",
                    "debt_to_equity": None,
                    "profit_margins": None,
                }
            )
    return results


# ── Portfolio Assistant — Portfolio Timeline ──────────────────────────────────


@router.get("/assistant/timeline")
async def assistant_timeline(
    current_user: CurrentUser,
    portfolio_id: str = QParam(default="default"),
) -> dict:
    """Portfolio equity curve vs Nifty50 benchmark over the past 6 months."""
    import pandas as pd
    import yfinance as yf

    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    repo = HoldingsRepository()
    holdings = await repo.list_holdings(str(current_user.id), portfolio_id)
    if not holdings:
        return {"dates": [], "portfolio": [], "nifty": []}

    period = "6mo"
    symbols = [h["symbol"] for h in holdings]
    qty_map = {h["symbol"]: h["qty"] for h in holdings}
    avg_map = {h["symbol"]: h["avg_price"] for h in holdings}

    # Download history for all holdings + Nifty benchmark
    all_syms = symbols + ["^NSEI"]
    try:
        raw = yf.download(all_syms, period=period, auto_adjust=True, progress=False)
        close = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw
    except Exception:
        return {"dates": [], "portfolio": [], "nifty": []}

    if close.empty:
        return {"dates": [], "portfolio": [], "nifty": []}

    dates = [d.strftime("%Y-%m-%d") for d in close.index]
    portfolio_values: list[float] = []
    nifty_values: list[float] = []

    # Get first Nifty close for normalization
    nifty_col = "^NSEI" if "^NSEI" in close.columns else None
    nifty_first = (
        float(close[nifty_col].dropna().iloc[0])
        if nifty_col and not close[nifty_col].dropna().empty
        else 1.0
    )

    # Start portfolio value = sum of (qty × avg_price) as baseline
    total_invested = sum(h["qty"] * h["avg_price"] for h in holdings)

    for _, row in close.iterrows():
        port_val = 0.0
        for sym in symbols:
            col = sym
            if col not in row.index:
                port_val += qty_map[sym] * avg_map[sym]
                continue
            price = row[col]
            if pd.isna(price):
                price = avg_map[sym]
            port_val += qty_map[sym] * float(price)
        portfolio_values.append(round(port_val, 2))

        # Nifty normalized to invested capital
        if nifty_col:
            nifty_price = row.get(nifty_col, nifty_first)
            nifty_val = (
                total_invested * (float(nifty_price) / nifty_first)
                if not pd.isna(nifty_price)
                else total_invested
            )
        else:
            nifty_val = total_invested
        nifty_values.append(round(nifty_val, 2))

    return {"dates": dates, "portfolio": portfolio_values, "nifty": nifty_values}


# ── Portfolio Assistant — Tax Analysis ────────────────────────────────────────


@router.get("/assistant/tax")
async def assistant_tax(
    current_user: CurrentUser,
    portfolio_id: str = QParam(default="default"),
) -> dict:
    """STCG/LTCG computation for all holdings per Indian equity tax rules."""
    from app.infra.db.repositories.holdings_repo import HoldingsRepository
    from app.infra.market_data.yfinance_client import YFinanceClient

    repo = HoldingsRepository()
    holdings = await repo.list_holdings(str(current_user.id), portfolio_id)
    if not holdings:
        return {"rows": [], "summary": {"total_stcg": 0, "total_ltcg": 0, "total_tax": 0}}

    client = YFinanceClient()
    rows = []
    total_stcg = 0.0
    total_ltcg = 0.0

    for h in holdings:
        sym = h["symbol"]
        qty = h["qty"]
        avg = h["avg_price"]
        buy_date_str = h.get("buy_date") or ""
        invested = qty * avg

        try:
            quote = await client.get_quote(sym)
            current_price = quote.price
        except Exception:
            current_price = avg

        pnl = (current_price - avg) * qty

        # Holding period
        days_held: int | None = None
        if buy_date_str:
            try:
                from datetime import date

                buy_dt = date.fromisoformat(str(buy_date_str)[:10])
                days_held = (date.today() - buy_dt).days
            except Exception:
                pass

        if days_held is None:
            tax_type = "Unknown"
            tax_rate = 0.0
            estimated_tax = 0.0
        elif days_held >= 365:
            tax_type = "LTCG"
            # LTCG: 10% above ₹1L exemption (per FY, simplified: applied per holding)
            taxable = max(0.0, pnl)
            tax_rate = 12.5  # post-Budget 2024: 12.5% LTCG
            estimated_tax = taxable * 0.125 if taxable > 0 else 0.0
            total_ltcg += pnl
        else:
            tax_type = "STCG"
            taxable = max(0.0, pnl)
            tax_rate = 20.0  # post-Budget 2024: 20% STCG
            estimated_tax = taxable * 0.20 if taxable > 0 else 0.0
            total_stcg += pnl

        rows.append(
            {
                "symbol": sym.replace(".NS", "").replace(".BO", ""),
                "qty": qty,
                "avg_price": round(avg, 2),
                "current_price": round(current_price, 2),
                "invested": round(invested, 2),
                "pnl": round(pnl, 2),
                "days_held": days_held,
                "tax_type": tax_type,
                "tax_rate": tax_rate,
                "estimated_tax": round(estimated_tax, 2),
                "buy_date": buy_date_str,
            }
        )

    ltcg_taxable = max(0.0, total_ltcg - 125_000)  # ₹1.25L LTCG exemption (FY25+)
    ltcg_tax = ltcg_taxable * 0.125
    stcg_tax = max(0.0, total_stcg) * 0.20

    return {
        "rows": sorted(rows, key=lambda r: r["pnl"]),
        "summary": {
            "total_stcg": round(total_stcg, 2),
            "total_ltcg": round(total_ltcg, 2),
            "stcg_tax": round(stcg_tax, 2),
            "ltcg_tax": round(ltcg_tax, 2),
            "total_tax": round(stcg_tax + ltcg_tax, 2),
            "ltcg_exemption_used": round(min(125_000, max(0, total_ltcg)), 2),
            "note": (
                "Tax rates: STCG 20%, LTCG 12.5% (Budget 2024). "
                "LTCG exempt up to ₹1.25L per FY."
            ),
        },
    }


# ── Portfolio Assistant — Dividend Analysis ───────────────────────────────────


@router.get("/assistant/dividends")
async def assistant_dividends(
    current_user: CurrentUser,
    portfolio_id: str = QParam(default="default"),
) -> list[dict]:
    """Historical dividends + yield-on-cost for each holding."""
    import yfinance as yf

    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    repo = HoldingsRepository()
    holdings = await repo.list_holdings(str(current_user.id), portfolio_id)
    if not holdings:
        return []

    results = []
    for h in holdings:
        sym = h["symbol"]
        qty = h["qty"]
        avg = h["avg_price"]
        try:
            ticker = yf.Ticker(sym)
            divs = ticker.dividends
            # Keep last 2 years
            recent = (
                divs[divs.index >= (divs.index[-1] - __import__("pandas").DateOffset(years=2))]
                if not divs.empty
                else divs
            )
            div_list = [
                {"date": d.strftime("%Y-%m-%d"), "amount": round(float(v), 4)}
                for d, v in recent.items()
            ]
            annual_income = (
                sum(v["amount"] for v in div_list)
                * qty
                / max(1, len(set(d["date"][:4] for d in div_list)) or 1)
            )
            yoc = (annual_income / (avg * qty) * 100) if avg * qty > 0 else 0.0
            info = ticker.info or {}
            dividend_yield = round((info.get("dividendYield") or 0) * 100, 2)
        except Exception:
            div_list = []
            annual_income = 0.0
            yoc = 0.0
            dividend_yield = 0.0

        results.append(
            {
                "symbol": sym.replace(".NS", "").replace(".BO", ""),
                "qty": qty,
                "avg_price": round(avg, 2),
                "dividends": div_list[-8:],  # last 8 payouts
                "annual_income_est": round(annual_income, 2),
                "yield_on_cost": round(yoc, 2),
                "current_yield": dividend_yield,
                "total_received_est": round(sum(d["amount"] for d in div_list) * qty, 2),
            }
        )
    return results


# ── Portfolio Assistant — Correlation Matrix ──────────────────────────────────


@router.get("/assistant/correlation")
async def assistant_correlation(
    current_user: CurrentUser,
    portfolio_id: str = QParam(default="default"),
) -> dict:
    """Daily returns correlation matrix for the user's holdings."""
    import pandas as pd
    import yfinance as yf

    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    repo = HoldingsRepository()
    holdings = await repo.list_holdings(str(current_user.id), portfolio_id)
    if len(holdings) < 2:
        return {"symbols": [], "matrix": []}

    symbols = [h["symbol"] for h in holdings]

    try:
        raw = yf.download(symbols, period="6mo", auto_adjust=True, progress=False)
        close = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw
        returns = close.pct_change().dropna()
        # Keep only columns we requested
        available = [s for s in symbols if s in returns.columns]
        if len(available) < 2:
            return {"symbols": [], "matrix": []}
        corr = returns[available].corr().round(2)
        avail_labels = [s.replace(".NS", "").replace(".BO", "") for s in available]
        matrix = corr.values.tolist()
    except Exception:
        return {"symbols": [], "matrix": []}

    return {"symbols": avail_labels, "matrix": matrix}


# ── Portfolio Assistant — News Sentiment (Phase 2) ────────────────────────────


@router.get("/assistant/sentiment")
async def assistant_sentiment(
    current_user: CurrentUser,
    portfolio_id: str = QParam(default="default"),
) -> list[dict]:
    """News sentiment for each holding from the Discovery engine."""
    from app.infra.db.repositories.discovery_repo import DiscoveryRepository
    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    h_repo = HoldingsRepository()
    d_repo = DiscoveryRepository()
    holdings = await h_repo.list_holdings(str(current_user.id), portfolio_id)
    if not holdings:
        return []

    results = []
    for h in holdings:
        sym_full = h["symbol"]  # e.g. SBIN.NS — matches how scanner persists it
        sym_clean = sym_full.replace(".NS", "").replace(".BO", "")
        # news mentioned_symbols may use either format; try both
        news = await d_repo.get_news(sym_full, limit=10) or await d_repo.get_news(
            sym_clean, limit=10
        )
        if not news:
            results.append(
                {
                    "symbol": sym_clean,
                    "news_count": 0,
                    "avg_sentiment": 0.0,
                    "bullish_count": 0,
                    "bearish_count": 0,
                    "neutral_count": 0,
                    "sentiment_label": "No Data",
                    "headlines": [],
                }
            )
            continue

        scores = [n.sentiment_score for n in news]
        avg = sum(scores) / len(scores) if scores else 0.0
        bullish = sum(1 for s in scores if s > 0.2)
        bearish = sum(1 for s in scores if s < -0.2)
        neutral = len(scores) - bullish - bearish
        label = (
            "Very Bullish"
            if avg > 0.5
            else "Bullish"
            if avg > 0.2
            else "Very Bearish"
            if avg < -0.5
            else "Bearish"
            if avg < -0.2
            else "Neutral"
        )

        headlines = []
        for n in news[:5]:
            pub = n.published_at
            pub_str = pub.strftime("%b %d") if hasattr(pub, "strftime") else str(pub)[:10]
            headlines.append(
                {
                    "title": n.title,
                    "source": n.source,
                    "url": n.url,
                    "published_at": pub_str,
                    "sentiment_score": round(n.sentiment_score, 3),
                }
            )

        results.append(
            {
                "symbol": sym_clean,
                "news_count": len(news),
                "avg_sentiment": round(avg, 3),
                "bullish_count": bullish,
                "bearish_count": bearish,
                "neutral_count": neutral,
                "sentiment_label": label,
                "headlines": headlines,
            }
        )

    return results


# ── Portfolio Assistant — AI Signals (Phase 2) ────────────────────────────────


@router.get("/assistant/ai-signals")
async def assistant_ai_signals(
    current_user: CurrentUser,
    portfolio_id: str = QParam(default="default"),
) -> list[dict]:
    """Latest Discovery-engine AI signal for each holding — entry, stop-loss, targets."""
    from app.infra.db.repositories.discovery_repo import DiscoveryRepository
    from app.infra.db.repositories.holdings_repo import HoldingsRepository

    h_repo = HoldingsRepository()
    d_repo = DiscoveryRepository()
    holdings = await h_repo.list_holdings(str(current_user.id), portfolio_id)
    if not holdings:
        return []

    results = []
    for h in holdings:
        sym_full = h["symbol"]  # e.g. SBIN.NS — matches how scanner persists it
        sym_clean = sym_full.replace(".NS", "").replace(".BO", "")
        # scores are stored with the full .NS symbol
        scores = await d_repo.get_scores_for_symbol(sym_full, limit=1)
        avg_price = h.get("avg_price", 0.0)
        qty = h.get("qty", 0)

        if not scores:
            results.append(
                {
                    "symbol": sym_clean,
                    "avg_price": avg_price,
                    "qty": qty,
                    "signal": "NO_DATA",
                    "confidence": 0.0,
                    "score": 0,
                    "entry_price": 0.0,
                    "stop_loss": 0.0,
                    "targets": [],
                    "news_score": 50.0,
                    "social_score": 50.0,
                    "technical_score": 50.0,
                    "explanation": "No AI scan data available. Run a Discovery scan first.",
                    "holding_period": "",
                    "risk_reward_ratio": 0.0,
                    "scanned_at": None,
                }
            )
            continue

        s = scores[0]
        scanned_str = s.scanned_at.strftime("%b %d, %H:%M") if s.scanned_at else None
        results.append(
            {
                "symbol": sym_clean,
                "avg_price": avg_price,
                "qty": qty,
                "signal": s.signal,
                "confidence": round(s.confidence, 3),
                "score": s.score,
                "entry_price": s.entry_price,
                "stop_loss": s.stop_loss,
                "targets": s.targets[:3],
                "news_score": round(s.news_score, 1),
                "social_score": round(s.social_score, 1),
                "technical_score": round(s.technical_score, 1),
                "explanation": s.explanation or s.news_summary or "",
                "holding_period": s.holding_period or "",
                "risk_reward_ratio": round(s.risk_reward_ratio, 2),
                "scanned_at": scanned_str,
            }
        )

    return results
