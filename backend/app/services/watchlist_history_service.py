"""Watchlist Pick History — daily jobs.

Two independent daily steps, run in the 15:35-16:00 IST EOD cluster
(see backend/app/core/scheduler.py):

1. ingest_todays_picks() (15:40 IST) — reads SotD/BTST/Golden Stock's
   already-generated picks for today (via their own repos, read-only — this
   module never touches their services) and creates new tracked-pick
   documents. Deliberately decoupled from the three source services so
   adding this feature can't regress them.

2. run_daily_price_snapshot() (15:45 IST) — appends today's close price and
   %P&L to every non-frozen tracked pick, freezing any that complete their
   tracking window (WATCHLIST_HISTORY_WINDOW_DAYS trading-day job-runs
   since announcement).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import structlog

from app.domain.models.watchlist_history import WatchlistHistoryPick, WatchlistHistorySnapshot
from app.infra.db.repositories.watchlist_history_repo import WatchlistHistoryRepository

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))


async def ingest_todays_picks() -> dict:
    """Create new watchlist_history_picks docs for today's SotD/BTST/Golden
    Stock picks. Idempotent — a symbol already ingested for a source+date is
    left untouched (create_if_new)."""
    repo = WatchlistHistoryRepository()
    await repo.ensure_indexes()
    today = datetime.now(IST).strftime("%Y-%m-%d")

    created = {"SOTD": 0, "BTST": 0, "GOLDEN_STOCK": 0}
    skipped = {"SOTD": 0, "BTST": 0, "GOLDEN_STOCK": 0}

    try:
        from app.infra.db.repositories.stock_of_day_repo import StockOfDayRepository

        sotd = await StockOfDayRepository().get_by_date(today)
        if sotd is not None:
            pick = WatchlistHistoryPick(
                source="SOTD",
                symbol=sotd.symbol,
                name=sotd.name,
                sector=sotd.sector,
                announced_date=today,
                announced_at=sotd.generated_at,
                buy_price=sotd.entry_price,
                stop_loss=sotd.stop_loss,
                target=sotd.target,
                source_ref_id=sotd.id,
                source_score=sotd.composite_score,
            )
            if await repo.create_if_new(pick):
                created["SOTD"] += 1
            else:
                skipped["SOTD"] += 1
    except Exception as exc:
        log.error("watchlist_history.ingest.sotd.error", error=str(exc))

    try:
        from app.infra.db.repositories.btst_repo import BTSTRepository

        scan = await BTSTRepository().get_scan_by_date(today)
        if scan is not None:
            for cand in scan.get("picks", []):
                pick = WatchlistHistoryPick(
                    source="BTST",
                    symbol=cand["symbol"],
                    name=cand.get("name", cand["symbol"]),
                    sector=cand.get("sector", ""),
                    announced_date=today,
                    announced_at=scan.get("scan_time", today),
                    buy_price=cand["entry_price"],
                    stop_loss=cand.get("stop_loss"),
                    target=cand.get("target_1"),
                    source_ref_id=scan.get("id"),
                    source_score=cand.get("confidence_score"),
                )
                if await repo.create_if_new(pick):
                    created["BTST"] += 1
                else:
                    skipped["BTST"] += 1
    except Exception as exc:
        log.error("watchlist_history.ingest.btst.error", error=str(exc))

    try:
        from app.infra.db.repositories.golden_stock_repo import GoldenStockRepository

        scan = await GoldenStockRepository().get_scan_by_date(today)
        if scan is not None:
            for cand in scan.get("picks", []):
                pick = WatchlistHistoryPick(
                    source="GOLDEN_STOCK",
                    symbol=cand["symbol"],
                    name=cand.get("name", cand["symbol"]),
                    sector=cand.get("sector", ""),
                    announced_date=today,
                    announced_at=scan.get("scan_time", today),
                    buy_price=cand["entry_price"],
                    stop_loss=cand.get("stop_loss"),
                    target=cand.get("target_1"),
                    source_ref_id=scan.get("id"),
                    source_score=cand.get("confidence_score"),
                )
                if await repo.create_if_new(pick):
                    created["GOLDEN_STOCK"] += 1
                else:
                    skipped["GOLDEN_STOCK"] += 1
    except Exception as exc:
        log.error("watchlist_history.ingest.golden_stock.error", error=str(exc))

    return {"date": today, "created": created, "skipped_existing": skipped}


async def run_daily_price_snapshot() -> dict:
    """Append today's close price/P&L to every non-frozen tracked pick,
    freezing any that complete their tracking window."""
    from app.infra.market_data.yfinance_client import YFinanceClient

    repo = WatchlistHistoryRepository()
    await repo.ensure_indexes()
    today = datetime.now(IST).strftime("%Y-%m-%d")

    active = await repo.list_active_for_date(today)
    if not active:
        return {"date": today, "processed": 0, "frozen": 0, "quote_failures": 0}

    client = YFinanceClient()
    symbols = sorted({p.symbol for p in active})
    import asyncio

    results = await asyncio.gather(
        *[client.get_quote(sym) for sym in symbols], return_exceptions=True
    )
    prices: dict[str, float] = {}
    for sym, r in zip(symbols, results):
        if not isinstance(r, Exception):
            prices[sym] = r.price

    frozen_count = 0
    quote_failures = 0
    now = datetime.now(timezone.utc)

    for pick in active:
        new_count = pick.trading_day_count + 1
        should_freeze = new_count >= pick.window_days
        price = prices.get(pick.symbol)

        if price is None:
            quote_failures += 1
            await repo.append_snapshot(
                pick.id,
                None,
                trading_day_count=new_count,
                last_price=pick.last_price,
                last_pnl_pct=pick.last_pnl_pct,
                last_snapshot_date=pick.last_snapshot_date,
                frozen=should_freeze,
                frozen_at=now.isoformat() if should_freeze else None,
                freeze_reason="WINDOW_COMPLETE" if should_freeze else None,
            )
            if should_freeze:
                frozen_count += 1
            continue

        pnl_pct = round((price - pick.buy_price) / pick.buy_price * 100, 2)
        snapshot = WatchlistHistorySnapshot(
            date=today,
            trading_day_number=pick.trading_day_count,
            price=price,
            pnl_pct=pnl_pct,
            captured_at=now,
        )
        await repo.append_snapshot(
            pick.id,
            snapshot,
            trading_day_count=new_count,
            last_price=price,
            last_pnl_pct=pnl_pct,
            last_snapshot_date=today,
            frozen=should_freeze,
            frozen_at=now.isoformat() if should_freeze else None,
            freeze_reason="WINDOW_COMPLETE" if should_freeze else None,
        )
        if should_freeze:
            frozen_count += 1

    return {
        "date": today,
        "processed": len(active),
        "frozen": frozen_count,
        "quote_failures": quote_failures,
    }
