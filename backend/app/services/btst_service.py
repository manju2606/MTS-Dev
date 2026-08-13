"""BTST (Buy Today, Sell Tomorrow) service.

Orchestrates:
  1. Run the BTST scan (once daily at 14:00 IST)
  2. Save results to MongoDB (one document per day)
  3. Add the top pick to each admin's persistent "BTST Watchlist"
  4. Send email with all top picks (LTP, score, entry/exit, SL, etc.)
  5. Resolve outcomes against target/stop-loss (called daily at 15:35 IST,
     checks every still-open pick from the last RESOLUTION_WINDOW_DAYS, not
     just yesterday's -- see resolve_btst_outcomes())
"""

import asyncio
from datetime import date, timedelta, timezone

import structlog

from app.infra.db.repositories.btst_repo import BTSTRepository
from app.infra.scanner.btst_scanner import BTSTScan, run_btst_scan

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))

# How many days a pick gets to actually hit its +5%/-3% target/stop-loss
# before being marked EXPIRED -- same convention as MCX's MCX_SIGNAL_EXPIRY_DAYS
# and Chartink's BREAKOUT_EXPIRY_DAYS (and Golden Stock's own version of this
# constant). Used to be a single next-day check that permanently locked in
# "expired" for anything that hadn't moved that much within one session --
# which is why ~88% of picks were expiring with no real outcome despite the
# name "Buy Today, Sell Tomorrow" -- now a pick just stays unresolved and
# gets re-checked on subsequent runs until it actually hits a threshold or
# this window elapses.
RESOLUTION_WINDOW_DAYS = 5


# ── Public entrypoints ────────────────────────────────────────────────────────


async def run_and_save_btst() -> BTSTScan:
    """Run scan, save to MongoDB, update watchlist, send email."""
    scan = await run_btst_scan()
    repo = BTSTRepository()
    await repo.save_scan(scan)
    log.info("btst.saved", picks=len(scan.picks), date=scan.scan_date)

    await asyncio.gather(
        _update_btst_watchlist(scan),
        _send_btst_email(scan),
        return_exceptions=True,
    )
    return scan


async def resolve_btst_outcomes(since_date: str | None = None) -> int:
    """Checks every not-yet-resolved pick from `since_date` onward (default:
    RESOLUTION_WINDOW_DAYS+2 calendar days back, a small buffer over the
    window itself) against its current price: target_hit if actual_pct
    >= 5.0%, sl_hit if actual_pct <= -3.0%, or expired once
    RESOLUTION_WINDOW_DAYS has passed with neither. A pick that hasn't hit
    either yet and is still within the window is simply left unresolved --
    it gets checked again next run instead of being forced to a verdict.

    Returns the number of picks resolved this run.
    """
    repo = BTSTRepository()
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

            if actual_pct >= 5.0:
                outcome = "target_hit"
            elif actual_pct <= -3.0:
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
                "btst.resolve.updated",
                symbol=sym,
                actual_close=actual_close,
                actual_pct=actual_pct,
                outcome=outcome,
            )
        except Exception as exc:
            log.warning("btst.resolve.error", symbol=sym, error=str(exc))

    tasks = [
        _resolve_pick(scan.get("id", ""), scan.get("scan_date", ""), pick)
        for scan in scans
        for pick in scan.get("picks", [])
    ]
    await asyncio.gather(*tasks, return_exceptions=True)
    log.info("btst.resolve.done", scans_checked=len(scans), updated=updated)
    return updated


# ── Watchlist ─────────────────────────────────────────────────────────────────


async def _update_btst_watchlist(scan: BTSTScan) -> None:
    """Add the top pick to each admin's persistent "BTST Watchlist" (accumulates)."""
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

        wl_name = "BTST Watchlist"
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
                        "VALUES (:id, :uid, :wlid, :sym, 'NSE', NOW()) ON CONFLICT DO NOTHING"
                    ),
                    {"id": str(uuid4()), "uid": uid, "wlid": wl_id, "sym": top_pick.symbol},
                )

            await session.commit()

        await engine.dispose()
        log.info("btst.watchlist.updated", name=wl_name, top_pick=top_pick.symbol)
    except Exception as exc:
        log.warning("btst.watchlist.error", error=str(exc))


# ── Email ─────────────────────────────────────────────────────────────────────


async def _send_btst_email(scan: BTSTScan) -> None:
    if not scan.picks:
        return
    try:
        from app.core.config import settings
        from app.infra.db.repositories.email_list_repo import EmailListRepository
        from app.infra.email.btst_report import btst_email_html
        from app.infra.email.client import send_email

        email_repo = EmailListRepository()
        managed = await email_repo.list_active_emails()
        fallback = settings.REPORT_TO_EMAIL or settings.SMTP_USER
        recipients = managed if managed else ([fallback] if fallback else [])
        if not recipients:
            return

        html = btst_email_html(scan)
        top_sym = scan.picks[0].symbol.replace(".NS", "") if scan.picks else "—"
        top_score = scan.picks[0].confidence_score if scan.picks else 0
        subject = (
            f"BTST Pick: {top_sym} · Score {top_score} · "
            f"{len(scan.picks)} candidates · {scan.scan_date}"
        )

        for to in recipients:
            try:
                await send_email(to=to, subject=subject, html=html)
            except Exception as exc:
                log.warning("btst.email.failed", to=to, error=str(exc))

        log.info("btst.email.sent", recipients=len(recipients))
    except Exception as exc:
        log.error("btst.email.error", error=str(exc))
