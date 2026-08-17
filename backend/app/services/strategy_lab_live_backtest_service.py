"""Backtests each live scanning strategy's ACTUAL historical picks (Golden
Stock, BTST, Stock of the Day, Chartink Breakout Watchlist, Golden Egg,
Kotegawa Reversal) --
not a synthetic re-simulation over historical market data (that would need
a whole separate point-in-time scanning engine per strategy, replicating
each one's live universe-scan logic against historical OHLCV day by day),
but the real recorded entry/exit prices each strategy's own resolver
already produced (see each source's resolver: golden_stock_service.
resolve_btst_outcomes, btst_service's function of the same name,
stock_of_day_service.run_sotd_price_check/expire_open_picks,
golden_egg_service.check_golden_egg_outcomes/expire_golden_egg_picks,
chartink_signal_service.resolve_breakout_alerts), run through the exact
same compute_metrics()/drawdown_curve() Strategy Lab uses for its
generated/hand-designed strategies -- so CAGR/Sharpe/Sortino/Max DD/etc
are directly comparable across both kinds of "backtest".

Position sizing: each trade independently deploys the full requested
capital (qty = floor(capital / entry_price)) rather than compounding one
shared account across overlapping trades -- these strategies fire
multiple concurrent picks (e.g. BTST fires a new pick most days while an
older one may still be open), so a single compounding equity curve would
need to model position overlap/capital contention that doesn't actually
reflect how a user would run five separate ideas side by side. Same
convention as "if you took every signal with the same capital each time".
"""

from __future__ import annotations

import dataclasses
from datetime import datetime

from app.domain.models.strategy_lab import TradeRecord
from app.domain.services.strategy_lab.engine import BacktestOutcome
from app.domain.services.strategy_lab.metrics import compute_metrics, drawdown_curve

SOURCE_LABELS = {
    "golden_stock": "Golden Stock (Intraday)",
    "btst": "BTST",
    "stock_of_day": "Stock of the Day",
    "chartink": "Chartink (Breakout Watchlist)",
    "golden_egg": "Golden Egg",
    "kotegawa": "Kotegawa Reversal (BNF Style)",
}


def _parse_dt(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        s = value if len(value) > 10 else f"{value}T00:00:00"
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def _trade_from_pick(p: dict, capital: float) -> TradeRecord | None:
    entry = p.get("entry_price")
    exit_price = p.get("exit_price")
    entry_time = _parse_dt(p.get("scan_date"))
    exit_time = _parse_dt(p.get("resolved_at")) or entry_time
    if entry is None or exit_price is None or entry_time is None or exit_time is None:
        return None
    if entry <= 0:
        return None
    if exit_time < entry_time:
        exit_time = entry_time
    elif exit_time == entry_time:
        # Same-session picks (SOTD/Golden Egg) can resolve same calendar day --
        # nudge the exit forward so avg_holding_hours/sharpe math never divides
        # by a zero-length holding period.
        exit_time = entry_time.replace(hour=15, minute=30) if entry_time.hour == 0 else exit_time

    qty = max(1, int(capital // entry))
    pnl = round((exit_price - entry) * qty, 2)
    pnl_pct = round((exit_price - entry) / entry * 100, 2)
    outcome = (p.get("outcome") or "").upper()
    exit_reason = (
        "target" if outcome in ("TARGET_HIT", "WIN") else
        "stop_loss" if outcome in ("SL_HIT", "LOSS") else
        "eod"
    )
    return TradeRecord(
        entry_time=entry_time, exit_time=exit_time, signal="BUY",
        entry_price=entry, exit_price=exit_price, quantity=qty,
        pnl=pnl, pnl_pct=pnl_pct, exit_reason=exit_reason,
    )


async def _fetch_picks(source: str, since_date: str | None) -> list[dict]:
    if source == "golden_stock":
        from app.infra.db.repositories.golden_stock_repo import GoldenStockRepository

        return await GoldenStockRepository().list_picks_by_outcome(
            ["target_hit", "sl_hit", "expired"], since_date, limit=2000
        )
    if source == "btst":
        from app.infra.db.repositories.btst_repo import BTSTRepository

        return await BTSTRepository().list_picks_by_outcome(
            ["target_hit", "sl_hit", "expired"], since_date, limit=2000
        )
    if source == "stock_of_day":
        from app.infra.db.repositories.stock_of_day_repo import StockOfDayRepository

        return await StockOfDayRepository().list_picks_by_outcome(
            ["WIN", "LOSS", "NEUTRAL"], since_date, limit=2000
        )
    if source == "golden_egg":
        from app.infra.db.repositories.golden_egg_repo import GoldenEggRepository

        return await GoldenEggRepository().list_picks_by_outcome(
            ["WIN", "LOSS", "NEUTRAL"], since_date, limit=2000
        )
    if source == "kotegawa":
        from app.infra.db.repositories.kotegawa_repo import KotegawaRepository

        return await KotegawaRepository().list_picks_by_outcome(
            ["target_hit", "sl_hit", "expired"], since_date, limit=2000
        )
    if source == "chartink":
        from app.infra.db.repositories.chartink_breakout_repo import (
            SQLChartinkBreakoutAlertRepository,
        )
        from app.infra.db.session import AsyncSessionLocal

        since_dt = _parse_dt(since_date)
        async with AsyncSessionLocal() as session:
            alerts = await SQLChartinkBreakoutAlertRepository(session).list_all_since(since_dt)
        return [
            {
                "symbol": a.symbol,
                "outcome": a.status,
                "entry_price": a.entry_price,
                "exit_price": a.exit_price,
                "scan_date": a.appeared_date,
                "resolved_at": (a.closed_at or a.created_at).isoformat(),
            }
            for a in alerts
            if a.status in ("WIN", "LOSS", "EXPIRED")
        ]
    raise ValueError(f"Unknown source '{source}'")


def _passes_gates(
    p: dict,
    min_confidence: float | None,
    max_rsi: float | None,
    min_volume_ratio: float | None,
    min_adx: float | None,
) -> bool:
    """Quality gates over the same confidence/RSI/ADX/volume-ratio fields
    Golden Stock and BTST already score each pick with (see their own
    IntradayCandidate-shaped documents) -- for testing whether only taking
    the highest-conviction picks would have made an underperforming
    strategy profitable, same idea as the Chartink Breakout Watchlist's own
    quality gates. A gate is silently skipped (not failed) for any source/
    pick missing that field entirely -- e.g. BTST has no adx -- rather than
    excluding every pick just because the strategy doesn't track that
    metric."""
    if min_confidence is not None:
        v = p.get("confidence_score")
        if v is None or v < min_confidence:
            return False
    if max_rsi is not None:
        v = p.get("rsi")
        if v is None or v > max_rsi:
            return False
    if min_volume_ratio is not None:
        v = p.get("volume_ratio")
        if v is None or v < min_volume_ratio:
            return False
    if min_adx is not None and "adx" in p:
        v = p.get("adx")
        if v is None or v < min_adx:
            return False
    return True


async def run_live_strategy_backtest(
    source: str,
    from_date: str | None,
    to_date: str | None,
    capital: float,
    min_confidence: float | None = None,
    max_rsi: float | None = None,
    min_volume_ratio: float | None = None,
    min_adx: float | None = None,
) -> dict:
    if source not in SOURCE_LABELS:
        raise ValueError(f"Unknown source '{source}'")

    all_picks = await _fetch_picks(source, from_date)
    picks = [
        p for p in all_picks
        if _passes_gates(p, min_confidence, max_rsi, min_volume_ratio, min_adx)
    ]
    trades = sorted(
        (t for t in (_trade_from_pick(p, capital) for p in picks) if t is not None),
        key=lambda t: t.exit_time,
    )
    if to_date:
        to_dt = _parse_dt(to_date)
        if to_dt is not None:
            trades = [t for t in trades if t.exit_time <= to_dt]

    if not trades:
        outcome = BacktestOutcome(trades=[], equity_curve=[], final_equity=capital)
        metrics = compute_metrics(outcome, capital)
        return {
            "source": source,
            "label": SOURCE_LABELS[source],
            "full_metrics": dataclasses.asdict(metrics),
            "equity_curve": [],
            "drawdown_curve": [],
            "trades": [],
            "total_trades": 0,
            "total_picks_before_gates": len(all_picks),
        }

    equity_curve = [{"time": trades[0].entry_time.isoformat(), "equity": capital}]
    running = capital
    for t in trades:
        running += t.pnl
        equity_curve.append({"time": t.exit_time.isoformat(), "equity": round(running, 2)})

    outcome = BacktestOutcome(trades=trades, equity_curve=equity_curve, final_equity=running)
    metrics = compute_metrics(outcome, capital)

    return {
        "source": source,
        "label": SOURCE_LABELS[source],
        "full_metrics": dataclasses.asdict(metrics),
        "equity_curve": equity_curve,
        "drawdown_curve": drawdown_curve(equity_curve),
        # Most recent 200 trades for the panel's trade table -- metrics above
        # are already computed over every trade, this is just for display.
        "trades": [dataclasses.asdict(t) for t in trades[-200:]],
        "total_trades": len(trades),
        "total_picks_before_gates": len(all_picks),
    }
