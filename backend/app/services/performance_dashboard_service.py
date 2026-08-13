"""Cross-engine Performance dashboard -- aggregates win/loss stats across
every AI-generated trading signal source in the app.

MCX (NG + Metals), Golden Stock, BTST, Stock of the Day, and paper trades
all have real, automatically-resolved WIN/LOSS/EXPIRED-style outcomes
(see each source's own resolver: mcx_signal_service.resolve_open_signals,
golden_stock_service.resolve_btst_outcomes, btst_service's function of
the same name, stock_of_day_service.run_sotd_price_check/
expire_open_picks, or a paper trade's own exit_price) and get a
normalized win-rate here.

Chartink and Golden Egg only ever score entry/SL/target once and never
check what actually happened to the price afterward -- no outcome
tracking exists for either yet -- so they contribute a "total calls"
count only, with win/loss explicitly left untracked (None) rather than
fabricated from e.g. a live-LTP snapshot, which is just a point-in-time
read, not a resolved outcome.

Each source's own win/target thresholds differ (Golden Stock: target
>=5%/SL <=-2.5%; BTST: target >=5%/SL <=-3%; SOTD: real SL/target price
levels, or a +-0.2% pnl_pct band for the end-of-day NEUTRAL bucket; MCX:
real SL/target price levels) -- this module does not attempt to
renormalize those thresholds against each other, only the resulting
WIN/LOSS/other-shaped counts into one common shape.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

IST = timezone(timedelta(hours=5, minutes=30))


def _since_dt(days: int | None) -> datetime | None:
    return None if days is None else datetime.utcnow() - timedelta(days=days)


def _since_date_str(days: int | None) -> str | None:
    return None if days is None else (datetime.now(IST) - timedelta(days=days)).strftime("%Y-%m-%d")


def _make(
    key: str,
    label: str,
    tracked: bool,
    total_calls: int,
    wins: int = 0,
    losses: int = 0,
    other: int = 0,
    avg_return_pct: float | None = None,
) -> dict:
    if not tracked:
        return {
            "key": key,
            "label": label,
            "tracked": False,
            "total_calls": total_calls,
            "resolved": None,
            "open": None,
            "wins": None,
            "losses": None,
            "other": None,
            "win_rate_pct": None,
            "avg_return_pct": None,
        }
    resolved = wins + losses + other
    return {
        "key": key,
        "label": label,
        "tracked": True,
        "total_calls": total_calls,
        "resolved": resolved,
        "open": max(total_calls - resolved, 0),
        "wins": wins,
        "losses": losses,
        "other": other,
        "win_rate_pct": round(wins / (wins + losses) * 100, 1) if (wins + losses) > 0 else None,
        "avg_return_pct": avg_return_pct,
    }


async def _mcx_stats(days: int | None) -> dict:
    from app.infra.db.repositories.mcx_signal_repo import McxSignalRepository

    signals = await McxSignalRepository().list_all_since(_since_dt(days))
    wins = sum(1 for s in signals if s.get("result") == "WIN")
    losses = sum(1 for s in signals if s.get("result") == "LOSS")
    expired = sum(1 for s in signals if s.get("result") == "EXPIRED")

    pct_returns = [
        s["pnl"] / s["entry_price"] * 100
        for s in signals
        if s.get("pnl") is not None and s.get("entry_price")
    ]
    avg_return_pct = round(sum(pct_returns) / len(pct_returns), 2) if pct_returns else None

    return _make(
        "mcx", "MCX (NG + Metals)", True, len(signals), wins, losses, expired, avg_return_pct
    )


async def _golden_stock_stats(days: int | None) -> dict:
    from app.infra.db.repositories.golden_stock_repo import GoldenStockRepository

    s = await GoldenStockRepository().get_performance_stats(_since_date_str(days))
    return _make(
        "golden_stock", "Golden Stock (Intraday)", True, s["total_calls"],
        s["target_hits"], s["sl_hits"], s["expired"], s["avg_return_pct"],
    )


async def _btst_stats(days: int | None) -> dict:
    from app.infra.db.repositories.btst_repo import BTSTRepository

    s = await BTSTRepository().get_performance_stats(_since_date_str(days))
    return _make(
        "btst", "BTST", True, s["total_calls"],
        s["target_hits"], s["sl_hits"], s["expired"], s["avg_return_pct"],
    )


async def _sotd_stats(days: int | None) -> dict:
    from app.infra.db.repositories.stock_of_day_repo import StockOfDayRepository

    s = await StockOfDayRepository().get_performance_stats(_since_date_str(days))
    return _make(
        "stock_of_day", "Stock of the Day", True, s["total_calls"],
        s["wins"], s["losses"], s["neutral"], s["avg_return_pct"],
    )


async def _paper_trades_stats(user_id: UUID, days: int | None) -> dict:
    from app.domain.models.trade import TradeStatus
    from app.infra.db.repositories.trade_repo import SQLTradeRepository
    from app.infra.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        trades = await SQLTradeRepository(session).list_by_user(user_id)

    since = _since_dt(days)
    if since is not None:
        trades = [t for t in trades if t.created_at >= since]

    closed = [t for t in trades if t.status == TradeStatus.CLOSED]
    wins = sum(1 for t in closed if (t.pnl or 0) > 0)
    losses = sum(1 for t in closed if (t.pnl or 0) <= 0)

    pct_returns = [
        t.pnl / (t.entry_price * t.quantity) * 100
        for t in closed
        if t.pnl is not None and t.entry_price and t.quantity
    ]
    avg_return_pct = round(sum(pct_returns) / len(pct_returns), 2) if pct_returns else None

    return _make("paper_trades", "Paper Trades", True, len(trades), wins, losses, 0, avg_return_pct)


async def _chartink_stats(days: int | None) -> dict:
    from app.infra.db.repositories.chartink_repo import SQLChartinkCandidateRepository
    from app.infra.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        total = await SQLChartinkCandidateRepository(session).count_calls_since(_since_dt(days))
    return _make("chartink", "Chartink", False, total)


async def _golden_egg_stats(days: int | None) -> dict:
    from app.infra.db.repositories.golden_egg_repo import GoldenEggRepository

    total = await GoldenEggRepository().count_calls_since(_since_dt(days))
    return _make("golden_egg", "Golden Egg", False, total)


async def get_performance_summary(user_id: UUID, days: int | None) -> dict:
    """One row per signal source plus a combined headline across the
    sources that actually have resolved win/loss data. `days=None` means
    all-time."""
    import asyncio

    sources = list(
        await asyncio.gather(
            _mcx_stats(days),
            _golden_stock_stats(days),
            _btst_stats(days),
            _sotd_stats(days),
            _paper_trades_stats(user_id, days),
            _chartink_stats(days),
            _golden_egg_stats(days),
        )
    )

    tracked = [s for s in sources if s["tracked"]]
    total_calls = sum(s["total_calls"] for s in sources)
    total_wins = sum(s["wins"] for s in tracked)
    total_losses = sum(s["losses"] for s in tracked)

    return {
        "days": days,
        "as_of": datetime.now(IST).isoformat(),
        "sources": sources,
        "overall": {
            "total_calls": total_calls,
            "tracked_sources": len(tracked),
            "untracked_sources": len(sources) - len(tracked),
            "wins": total_wins,
            "losses": total_losses,
            "win_rate_pct": (
                round(total_wins / (total_wins + total_losses) * 100, 1)
                if (total_wins + total_losses) > 0
                else None
            ),
        },
    }
