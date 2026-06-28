"""Portfolio P&L summary — open positions with live prices + closed trade history."""

import asyncio
from datetime import datetime

from fastapi import APIRouter

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
