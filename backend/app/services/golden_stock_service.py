"""Golden Stock — Intraday service.

Orchestrates:
  1. Run the two-pass scan (runs once at 15:00 IST)
  2. Save results to MongoDB
  3. Create an Intraday watchlist in PostgreSQL for admin users (top 1 pick only)
  4. Send email with all top picks
  5. Resolve next-day outcomes (called at 10:00 IST the following day)
"""

import asyncio
from datetime import timedelta, timezone

import structlog

from app.infra.db.repositories.golden_stock_repo import GoldenStockRepository
from app.infra.scanner.golden_stock_scanner import GoldenStockScan, run_golden_stock_scan

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))


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


async def resolve_btst_outcomes(target_date: str) -> int:
    """Resolve yesterday's Intraday picks by fetching actual closing prices.

    Returns the number of picks updated.
    """
    repo = GoldenStockRepository()
    doc = await repo.get_scan_by_date(target_date)
    if not doc:
        log.warning("golden_stock.resolve.no_scan", date=target_date)
        return 0

    scan_id = doc.get("id", "")
    picks = doc.get("picks", [])
    if not picks:
        return 0

    import yfinance as yf

    loop = asyncio.get_event_loop()
    updated = 0

    async def _resolve_pick(pick: dict) -> None:
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

            await repo.update_pick_outcome(scan_id, sym, actual_close, round(actual_pct, 2))
            updated += 1
            log.info(
                "golden_stock.resolve.updated",
                symbol=sym,
                actual_close=actual_close,
                actual_pct=actual_pct,
            )
        except Exception as exc:
            log.warning("golden_stock.resolve.error", symbol=sym, error=str(exc))

    await asyncio.gather(*[_resolve_pick(p) for p in picks], return_exceptions=True)
    log.info("golden_stock.resolve.done", date=target_date, updated=updated)
    return updated


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
