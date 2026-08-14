"""Golden Stock — Intraday service.

Orchestrates:
  1. Run the two-pass scan (runs once at 15:00 IST)
  2. Save results to MongoDB
  3. Create an Intraday watchlist in PostgreSQL for admin users (top 1 pick only)
  4. Send email with all top picks
  5. Resolve outcomes against target/stop-loss (called daily at 10:00 IST,
     checks every still-open pick from the last RESOLUTION_WINDOW_DAYS, not
     just yesterday's -- see resolve_btst_outcomes())
"""

import asyncio
from datetime import date, timedelta, timezone
from typing import Any

import structlog

from app.infra.db.repositories.golden_stock_repo import GoldenStockRepository
from app.infra.scanner.golden_stock_scanner import GoldenStockScan, run_golden_stock_scan

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))

# How many days a pick gets to actually hit its own real target_1/stop_loss
# price levels (see resolve_btst_outcomes -- these are ATR-sized per stock by
# golden_stock_scanner.py, not a flat percentage) before being marked
# EXPIRED -- same convention as MCX's MCX_SIGNAL_EXPIRY_DAYS and Chartink's
# BREAKOUT_EXPIRY_DAYS (and BTST's own version of this constant). Used to be
# a single same-next-day check (permanently locking in "expired" for
# anything that hadn't moved 5% within one session -- which is why ~90% of
# picks were expiring with no real outcome), now a pick just stays
# unresolved and gets re-checked on subsequent runs until it actually hits a
# level or this window elapses.
RESOLUTION_WINDOW_DAYS = 5


# ── Public entrypoints ────────────────────────────────────────────────────────


async def run_and_save_golden_stock() -> GoldenStockScan:
    """Run scan, save to MongoDB, create watchlist, send email."""
    scan = await run_golden_stock_scan()
    repo = GoldenStockRepository()
    await repo.save_scan(scan)
    log.info("golden_stock.saved", picks=len(scan.picks), date=scan.scan_date)

    await asyncio.gather(
        _create_intraday_watchlist(scan),
        _send_intraday_email(scan),
        return_exceptions=True,
    )
    return scan


async def resolve_btst_outcomes(since_date: str | None = None) -> int:
    """Checks every not-yet-resolved pick from `since_date` onward (default:
    RESOLUTION_WINDOW_DAYS+2 calendar days back, a small buffer over the
    window itself) against its current price: target_hit if actual_close
    reaches the pick's own target_1, sl_hit if actual_close falls to its own
    stop_loss, or expired once RESOLUTION_WINDOW_DAYS has passed with
    neither. A pick that hasn't hit either yet and is still within the
    window is simply left unresolved -- it gets checked again next run
    instead of being forced to a verdict.

    Resolves against the pick's own ATR-sized target_1/stop_loss price
    levels (see golden_stock_scanner.py's own sizing) rather than a flat
    +5%/-2.5% band -- a fixed band meant most picks' real (often tighter)
    levels were never actually being checked, so wins/losses that already
    happened at the stock's own target/stop just kept drifting until they
    either coincidentally crossed the flat band or timed out as "expired".
    Falls back to the +5%/-2.5% band only for picks saved before
    target_1/stop_loss existed on the record.

    Returns the number of picks resolved this run.
    """
    repo = GoldenStockRepository()
    if since_date is None:
        since_date = (date.today() - timedelta(days=RESOLUTION_WINDOW_DAYS + 2)).isoformat()

    scans = await repo.list_scans_with_unresolved_picks(since_date)
    if not scans:
        return 0

    import yfinance as yf

    loop = asyncio.get_event_loop()
    updated = 0
    today = date.today()

    async def _resolve_pick(scan_id: str, scan_date: str, pick: dict) -> None:
        nonlocal updated
        if pick.get("outcome") is not None:
            return
        sym = pick.get("symbol", "")
        if not sym:
            return
        try:

            def _fetch() -> float | None:
                ticker = yf.Ticker(sym)
                hist = ticker.history(period="2d")
                if hist is None or hist.empty:
                    return None
                return float(hist["Close"].iloc[-1])

            actual_close = await loop.run_in_executor(None, _fetch)
            if actual_close is None:
                return

            entry = pick.get("entry_price", 0.0)
            actual_pct = (actual_close - entry) / entry * 100 if entry > 0 else 0.0
            target_1 = pick.get("target_1")
            stop_loss = pick.get("stop_loss")

            if target_1 is not None and stop_loss is not None:
                target_hit = actual_close >= target_1
                sl_hit = actual_close <= stop_loss
            else:
                # Defensive fallback for a pick saved before target_1/stop_loss
                # existed on the record -- shouldn't happen for anything the
                # current scanner produces, but avoids crashing resolution on
                # stale data instead of silently leaving it unresolved forever.
                target_hit = actual_pct >= 5.0
                sl_hit = actual_pct <= -2.5

            if target_hit:
                outcome = "target_hit"
            elif sl_hit:
                outcome = "sl_hit"
            else:
                age_days = (today - date.fromisoformat(scan_date)).days
                if age_days < RESOLUTION_WINDOW_DAYS:
                    return
                outcome = "expired"

            await repo.update_pick_outcome(
                scan_id, sym, actual_close, round(actual_pct, 2), outcome
            )
            updated += 1
            log.info(
                "golden_stock.resolve.updated",
                symbol=sym,
                actual_close=actual_close,
                actual_pct=actual_pct,
                outcome=outcome,
            )
        except Exception as exc:
            log.warning("golden_stock.resolve.error", symbol=sym, error=str(exc))

    tasks = [
        _resolve_pick(scan.get("id", ""), scan.get("scan_date", ""), pick)
        for scan in scans
        for pick in scan.get("picks", [])
    ]
    await asyncio.gather(*tasks, return_exceptions=True)
    log.info("golden_stock.resolve.done", scans_checked=len(scans), updated=updated)
    return updated


async def backfill_golden_stock_outcomes(dry_run: bool = True) -> dict:
    """One-off re-grade of every already-resolved Golden Stock pick against
    its own real target_1/stop_loss, for picks that were graded under the
    old flat +5%/-2.5% band before resolve_btst_outcomes() (Golden Stock's
    own resolver, same name as BTST's for historical reasons) was fixed to
    use each pick's own ATR-sized levels. Mirrors BTST's
    backfill_btst_outcomes -- see that function's docstring for the full
    rationale (day-after-scan_date walk, stop-loss-priority tie-break,
    close-based checks to match the live resolver's own methodology).

    dry_run=True (default) only tallies what WOULD change without writing
    anything -- always inspect the summary before calling with
    dry_run=False.
    """
    repo = GoldenStockRepository()
    picks = await repo.list_resolved_picks_with_scan_id()

    import yfinance as yf

    loop = asyncio.get_event_loop()
    changed = 0
    unchanged = 0
    skipped = 0
    errors = 0
    new_outcome_counts: dict[str, int] = {}
    changes: list[dict] = []

    async def _backfill_pick(p: dict) -> None:
        nonlocal changed, unchanged, skipped, errors
        target_1 = p.get("target_1")
        stop_loss = p.get("stop_loss")
        entry = p.get("entry_price")
        sym = p.get("symbol")
        scan_date = p.get("scan_date")
        if target_1 is None or stop_loss is None or not entry or not sym or not scan_date:
            skipped += 1
            return
        try:
            start = date.fromisoformat(scan_date)
            end = start + timedelta(days=RESOLUTION_WINDOW_DAYS + 5)

            def _fetch() -> Any:
                ticker = yf.Ticker(sym)
                return ticker.history(start=start.isoformat(), end=end.isoformat())

            hist = await loop.run_in_executor(None, _fetch)
            if hist is None or hist.empty:
                errors += 1
                return

            hist = hist[hist.index.date > start]
            if hist.empty:
                errors += 1
                return
            window = hist.iloc[:RESOLUTION_WINDOW_DAYS]

            new_outcome: str | None = None
            new_close: float | None = None
            for _, row in window.iterrows():
                close = float(row["Close"])
                if close <= stop_loss:
                    new_outcome, new_close = "sl_hit", close
                    break
                if close >= target_1:
                    new_outcome, new_close = "target_hit", close
                    break

            if new_outcome is None:
                if window.empty:
                    errors += 1
                    return
                new_outcome = "expired"
                new_close = float(window.iloc[-1]["Close"])

            assert new_close is not None
            new_pct = round((new_close - entry) / entry * 100, 2)
            old_close = p.get("actual_close") or 0.0

            if new_outcome == p.get("outcome") and abs(old_close - new_close) < 0.01:
                unchanged += 1
                return

            changed += 1
            new_outcome_counts[new_outcome] = new_outcome_counts.get(new_outcome, 0) + 1
            changes.append(
                {
                    "symbol": sym,
                    "scan_date": scan_date,
                    "old_outcome": p.get("outcome"),
                    "new_outcome": new_outcome,
                    "old_actual_close": p.get("actual_close"),
                    "new_actual_close": new_close,
                }
            )

            if not dry_run:
                await repo.update_pick_outcome(p["scan_id"], sym, new_close, new_pct, new_outcome)
        except Exception as exc:
            errors += 1
            log.warning("golden_stock.backfill.error", symbol=sym, error=str(exc))

    await asyncio.gather(*(_backfill_pick(p) for p in picks), return_exceptions=True)

    result = {
        "total_checked": len(picks),
        "changed": changed,
        "unchanged": unchanged,
        "skipped": skipped,
        "errors": errors,
        "new_outcome_counts": new_outcome_counts,
        "dry_run": dry_run,
        "sample_changes": changes[:30],
    }
    log.info(
        "golden_stock.backfill.done",
        **{k: v for k, v in result.items() if k != "sample_changes"},
    )
    return result


# ── Watchlist creation ────────────────────────────────────────────────────────


async def _create_intraday_watchlist(scan: GoldenStockScan) -> None:
    """Add the top pick to each admin's persistent "Intraday Watchlist"
    (accumulates across the day)."""
    if not scan.picks:
        return
    try:
        from uuid import uuid4

        from sqlalchemy import select, text
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

        from app.core.config import settings
        from app.infra.db.models import UserORM

        engine = create_async_engine(settings.DATABASE_URL)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

        wl_name = "Intraday Watchlist"
        top_pick = scan.picks[0]

        async with Session() as session:
            result = await session.execute(
                select(UserORM).where(UserORM.role == "admin", UserORM.is_active.is_(True)).limit(5)
            )
            admins = result.scalars().all()

            if not admins:
                result = await session.execute(
                    select(UserORM).where(UserORM.is_active.is_(True)).limit(1)
                )
                admins = result.scalars().all()

            for admin in admins:
                uid = str(admin.id)

                existing = await session.execute(
                    text("SELECT id FROM watchlists WHERE user_id = :uid AND name = :name"),
                    {"uid": uid, "name": wl_name},
                )
                wl_id = existing.scalar()
                if wl_id is None:
                    wl_id = str(uuid4())
                    await session.execute(
                        text(
                            "INSERT INTO watchlists (id, user_id, name, created_at) "
                            "VALUES (:id, :uid, :name, NOW())"
                        ),
                        {"id": wl_id, "uid": uid, "name": wl_name},
                    )
                else:
                    wl_id = str(wl_id)

                await session.execute(
                    text(
                        "INSERT INTO watchlist_items "
                        "(id, user_id, watchlist_id, symbol, exchange, added_at) "
                        "VALUES (:id, :uid, :wlid, :sym, 'NSE', NOW()) "
                        "ON CONFLICT DO NOTHING"
                    ),
                    {
                        "id": str(uuid4()),
                        "uid": uid,
                        "wlid": wl_id,
                        "sym": top_pick.symbol,
                    },
                )

            await session.commit()

        await engine.dispose()
        log.info("golden_stock.watchlist.updated", name=wl_name, top_pick=top_pick.symbol)
    except Exception as exc:
        log.warning("golden_stock.watchlist.error", error=str(exc))


# ── Email ─────────────────────────────────────────────────────────────────────


async def _send_intraday_email(scan: GoldenStockScan) -> None:
    if not scan.picks:
        return
    try:
        from app.core.config import settings
        from app.infra.db.repositories.email_list_repo import EmailListRepository
        from app.infra.email.client import send_email
        from app.infra.email.golden_stock_report import golden_stock_email_html

        email_repo = EmailListRepository()
        managed = await email_repo.list_active_emails()
        fallback = settings.REPORT_TO_EMAIL or settings.SMTP_USER
        recipients = managed if managed else ([fallback] if fallback else [])

        if not recipients:
            return

        html = golden_stock_email_html(scan)
        top_sym = scan.picks[0].symbol.replace(".NS", "") if scan.picks else "—"
        top_score = scan.picks[0].confidence_score if scan.picks else 0
        subject = (
            f"Golden Stock Intraday: {top_sym} · Score {top_score} · "
            f"{len(scan.picks)} picks · {scan.scan_date}"
        )

        for to in recipients:
            try:
                await send_email(to=to, subject=subject, html=html)
            except Exception as exc:
                log.warning("golden_stock.email.failed", to=to, error=str(exc))

        log.info("golden_stock.email.sent", recipients=len(recipients))
    except Exception as exc:
        log.error("golden_stock.email.error", error=str(exc))
