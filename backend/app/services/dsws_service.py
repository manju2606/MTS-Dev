"""DSWS — Daily Discovery Watchlist Summary service.

Orchestrates:
  1. 09:30 IST: snapshot the Discovery Engine's current picks into four
     signal-strength buckets (append-only — safe to re-run).
  2. Every 30 min, 10:00-15:30 IST: record a price checkpoint for every pick.
  3. 15:35 IST: close out the day (last checkpoint becomes the close).
  4. On demand: aggregate day/week/month performance into a report.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import structlog

from app.domain.models.dsws import DSWS_BUCKETS, DswsCheckpoint, DswsPick
from app.infra.db.repositories.discovery_repo import DiscoveryRepository
from app.infra.db.repositories.dsws_repo import DswsRepository
from app.infra.market_data.composite_client import CompositeMarketDataClient

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))


# ── Public entrypoints ──────────────────────────────────────────────────────


async def generate_daily_watchlist() -> dict:
    """Bucket today's latest Discovery Engine picks by exact signal strength.

    Append-only: symbols already present in a bucket for today are left
    untouched, so calling this more than once a day (cron + a manual re-run)
    never duplicates a pick.
    """
    today = datetime.now(IST).strftime("%Y-%m-%d")
    now = datetime.now(IST)

    discovery_repo = DiscoveryRepository()
    scores = await discovery_repo.get_top_picks(limit=500)

    dsws_repo = DswsRepository()
    added_total = 0
    for bucket in DSWS_BUCKETS:
        bucket_scores = [s for s in scores if s.signal == bucket]
        picks = [
            DswsPick(
                symbol=s.symbol,
                name=s.name,
                signal=s.signal,
                score=s.score,
                entry_price=s.entry_price,
                stop_loss=s.stop_loss,
                target=s.targets[0] if s.targets else s.entry_price,
                added_at=now,
            )
            for s in bucket_scores
        ]
        added = await dsws_repo.upsert_picks(today, bucket, picks)
        added_total += added

    log.info("dsws.generate.done", date=today, added=added_total)
    return await dsws_repo.get_scan_by_date(today) or {}


async def track_checkpoint() -> int:
    """Fetch a live quote for every pick in today's watchlist and record a
    checkpoint. Returns the number of checkpoints recorded."""
    today = datetime.now(IST).strftime("%Y-%m-%d")
    now = datetime.now(IST)
    time_label = now.strftime("%H:%M")

    dsws_repo = DswsRepository()
    doc = await dsws_repo.get_scan_by_date(today)
    if doc is None:
        log.warning("dsws.track.no_scan", date=today)
        return 0

    client = CompositeMarketDataClient()

    async def _track_one(bucket: str, pick: dict) -> bool:
        symbol = pick["symbol"]
        entry_price = pick["entry_price"]
        try:
            quote = await client.get_quote(symbol)
        except Exception as exc:
            log.warning("dsws.track.quote_failed", symbol=symbol, error=str(exc))
            return False

        pct_change = (quote.price - entry_price) / entry_price * 100 if entry_price else 0.0
        checkpoint = DswsCheckpoint(
            time=time_label,
            price=quote.price,
            pct_change=round(pct_change, 2),
            captured_at=now,
        )
        await dsws_repo.add_checkpoint(today, bucket, symbol, checkpoint)
        return True

    tasks = [
        _track_one(bucket, pick)
        for bucket in DSWS_BUCKETS
        for pick in doc.get("buckets", {}).get(bucket, [])
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    recorded = sum(1 for r in results if r is True)
    log.info("dsws.track.done", date=today, recorded=recorded, attempted=len(tasks))
    return recorded


async def close_out_day() -> int:
    """15:35 IST: take each pick's most recent checkpoint as its close for
    the day. Returns the number of picks closed out."""
    today = datetime.now(IST).strftime("%Y-%m-%d")
    dsws_repo = DswsRepository()
    doc = await dsws_repo.get_scan_by_date(today)
    if doc is None:
        log.warning("dsws.close.no_scan", date=today)
        return 0

    closed = 0
    for bucket in DSWS_BUCKETS:
        for pick in doc.get("buckets", {}).get(bucket, []):
            checkpoints = pick.get("checkpoints", [])
            if not checkpoints:
                continue
            last = checkpoints[-1]
            await dsws_repo.set_close(
                today, bucket, pick["symbol"], last["price"], last["pct_change"]
            )
            closed += 1

    await dsws_repo.mark_closed_out(today)
    log.info("dsws.close.done", date=today, closed=closed)
    return closed


async def get_report(period: str, date: str) -> dict:
    """Aggregate performance over a day/week/month ending on `date`.

    `period` is "day" | "week" | "month". For a pick whose day hasn't been
    closed out yet, falls back to its latest checkpoint's pct_change.
    """
    end = datetime.strptime(date, "%Y-%m-%d")
    if period == "day":
        start = end
    elif period == "week":
        start = end - timedelta(days=end.weekday())  # Monday of that week
    elif period == "month":
        start = end.replace(day=1)
    else:
        raise ValueError(f"unknown period: {period}")

    dsws_repo = DswsRepository()
    docs = await dsws_repo.get_scans_between(start.strftime("%Y-%m-%d"), date)

    per_bucket: dict[str, list[dict]] = {b: [] for b in DSWS_BUCKETS}
    for doc in docs:
        for bucket in DSWS_BUCKETS:
            for pick in doc.get("buckets", {}).get(bucket, []):
                pct = pick.get("close_pct")
                if pct is None:
                    checkpoints = pick.get("checkpoints", [])
                    pct = checkpoints[-1]["pct_change"] if checkpoints else None
                if pct is None:
                    continue
                per_bucket[bucket].append(
                    {
                        "symbol": pick["symbol"],
                        "name": pick.get("name", pick["symbol"]),
                        "scan_date": doc["scan_date"],
                        "pct_change": pct,
                    }
                )

    bucket_stats = {bucket: _compute_stats(entries) for bucket, entries in per_bucket.items()}

    # Other pick-generating engines, folded into the same report so their
    # performance is directly comparable to the Discovery Engine's buckets.
    start_str = start.strftime("%Y-%m-%d")
    from app.infra.db.repositories.btst_repo import BTSTRepository
    from app.infra.db.repositories.golden_stock_repo import GoldenStockRepository
    from app.infra.db.repositories.stock_of_day_repo import StockOfDayRepository

    engine_entries = {
        "STOCK_OF_DAY": await StockOfDayRepository().get_resolved_picks_between(start_str, date),
        "GOLDEN_STOCK": await GoldenStockRepository().get_resolved_picks_between(start_str, date),
        "BTST": await BTSTRepository().get_resolved_picks_between(start_str, date),
    }
    engine_stats = {name: _compute_stats(entries) for name, entries in engine_entries.items()}

    all_entries = [e for entries in per_bucket.values() for e in entries]
    for entries in engine_entries.values():
        all_entries.extend(entries)

    best_overall = max(all_entries, key=lambda e: e["pct_change"]) if all_entries else None
    worst_overall = min(all_entries, key=lambda e: e["pct_change"]) if all_entries else None

    return {
        "period": period,
        "start_date": start_str,
        "end_date": date,
        "days_included": len(docs),
        "buckets": bucket_stats,
        "engines": engine_stats,
        "best_stock": best_overall,
        "worst_stock": worst_overall,
    }


def _compute_stats(entries: list[dict]) -> dict:
    """count/avg-return/win-rate/best/worst over a flat list of
    {symbol, name, scan_date, pct_change} entries — shared by DSWS's own
    signal buckets and the other pick-generating engines' resolved picks."""
    if not entries:
        return {"count": 0, "avg_return_pct": 0.0, "win_rate_pct": 0.0, "best": None, "worst": None}
    wins = sum(1 for e in entries if e["pct_change"] > 0)
    return {
        "count": len(entries),
        "avg_return_pct": round(sum(e["pct_change"] for e in entries) / len(entries), 2),
        "win_rate_pct": round(wins / len(entries) * 100, 1),
        "best": max(entries, key=lambda e: e["pct_change"]),
        "worst": min(entries, key=lambda e: e["pct_change"]),
    }
