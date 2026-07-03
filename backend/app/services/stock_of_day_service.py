"""Stock-of-the-Day service.

Orchestrates:
  1. Daily pick generation — aggregates discovery + scanner signals
  2. Auto paper trade     — placed when composite_score >= 85
  3. Price monitoring     — closes auto-trade when SL or target is hit
  4. Journaling           — every lifecycle event is logged to MongoDB
  5. Email notifications  — pick generated, trade placed, SL/target hit
"""

import asyncio
from datetime import date, datetime, timezone, timedelta
from uuid import uuid4

import structlog

from app.domain.models.stock_of_day import AUTO_TRADE_THRESHOLD, StockOfDay
from app.infra.db.repositories.stock_of_day_repo import StockOfDayRepository

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))


# ── Public entrypoints ────────────────────────────────────────────────────────

async def generate_and_save_daily_pick() -> StockOfDay | None:
    """Main entry: build today's SotD pick and optionally auto-trade it."""
    today = datetime.now(IST).strftime("%Y-%m-%d")
    repo = StockOfDayRepository()

    existing = await repo.get_by_date(today)
    if existing:
        log.info("sotd.already_generated", date=today, symbol=existing.symbol)
        return existing

    sotd = await _build_pick(today)
    if sotd is None:
        return None

    cfg = await repo.get_settings()
    log.info(
        "sotd.threshold_check",
        symbol=sotd.symbol,
        composite_score=sotd.composite_score,
        threshold=cfg.threshold,
        passes=sotd.composite_score >= cfg.threshold,
        auto_trade_enabled=cfg.auto_trade_enabled,
        will_attempt_trade=cfg.auto_trade_enabled and sotd.composite_score >= cfg.threshold,
    )
    if cfg.auto_trade_enabled and sotd.composite_score >= cfg.threshold:
        await _auto_place_trade(sotd, cfg)

    await repo.save(sotd)
    await _add_to_sotd_watchlist(sotd)

    await repo.add_journal_entry(today, "PICK_GENERATED", {
        "symbol": sotd.symbol,
        "composite_score": sotd.composite_score,
        "signal": sotd.discovery_signal,
        "scanner_hits": sotd.scanner_hits,
        "auto_traded": sotd.auto_traded,
        "entry_price": sotd.entry_price,
        "stop_loss": sotd.stop_loss,
        "target": sotd.target,
    })

    await _send_sotd_pick_email(sotd)
    log.info("sotd.generated", symbol=sotd.symbol, score=sotd.composite_score, auto_traded=sotd.auto_traded)
    return sotd


async def run_sotd_price_check() -> None:
    """Check all TRADING picks against current price; close on SL/target hit."""
    repo = StockOfDayRepository()
    trading = await repo.list_trading()
    if not trading:
        return

    from app.infra.market_data.yfinance_client import YFinanceClient
    client = YFinanceClient()

    symbols = [s.symbol for s in trading]
    results = await asyncio.gather(
        *[client.get_quote(sym) for sym in symbols], return_exceptions=True
    )
    prices: dict[str, float] = {}
    for sym, r in zip(symbols, results, strict=True):
        if not isinstance(r, Exception):
            prices[sym] = r.price

    for sotd in trading:
        price = prices.get(sotd.symbol)
        if price is None:
            continue

        stop_hit   = price <= sotd.stop_loss
        target_hit = price >= sotd.target

        if not (stop_hit or target_hit):
            continue

        event     = "TARGET_HIT" if target_hit else "STOP_HIT"
        outcome   = "WIN"        if target_hit else "LOSS"
        pnl_pct   = round((price - sotd.entry_price) / sotd.entry_price * 100, 2)

        sotd.status     = event
        sotd.exit_price = price
        sotd.exit_time  = datetime.utcnow().isoformat()
        sotd.pnl_pct    = pnl_pct
        sotd.outcome    = outcome
        await repo.update(sotd)

        await repo.add_journal_entry(sotd.date, event, {
            "symbol": sotd.symbol,
            "trigger_price": price,
            "entry_price": sotd.entry_price,
            "stop_loss": sotd.stop_loss,
            "target": sotd.target,
            "pnl_pct": pnl_pct,
            "outcome": outcome,
        })

        # Close the linked paper trade in PostgreSQL
        if sotd.paper_trade_id:
            await _close_paper_trade(sotd.paper_trade_id, price)

        await _send_sotd_event_email(sotd, event)
        log.info("sotd.price_check.triggered", symbol=sotd.symbol, event=event, price=price)


async def expire_open_picks() -> None:
    """Called at 15:35 IST: close any still-TRADING picks at current market price."""
    repo = StockOfDayRepository()
    trading = await repo.list_trading()
    if not trading:
        return

    from app.infra.market_data.yfinance_client import YFinanceClient
    client = YFinanceClient()

    for sotd in trading:
        try:
            quote = await client.get_quote(sotd.symbol)
            price = quote.price
        except Exception:
            price = sotd.entry_price

        pnl_pct = round((price - sotd.entry_price) / sotd.entry_price * 100, 2)
        outcome = "WIN" if pnl_pct > 0.2 else "LOSS" if pnl_pct < -0.2 else "NEUTRAL"

        sotd.status     = "EXPIRED"
        sotd.exit_price = price
        sotd.exit_time  = datetime.utcnow().isoformat()
        sotd.pnl_pct    = pnl_pct
        sotd.outcome    = outcome
        await repo.update(sotd)

        await repo.add_journal_entry(sotd.date, "EXPIRED", {
            "symbol": sotd.symbol,
            "exit_price": price,
            "pnl_pct": pnl_pct,
            "outcome": outcome,
        })

        if sotd.paper_trade_id:
            await _close_paper_trade(sotd.paper_trade_id, price)

        await _send_sotd_event_email(sotd, "EXPIRED")


# ── Pick generation ───────────────────────────────────────────────────────────

async def _build_pick(today: str) -> StockOfDay | None:
    from app.infra.db.repositories.discovery_repo import DiscoveryRepository
    from app.infra.scanner.market_scanner import run_market_scan

    disc_repo = DiscoveryRepository()
    candidates = await disc_repo.get_top_picks(limit=40, min_score=60)
    bullish = [c for c in candidates if c.signal in ("STRONG_BUY", "BUY")]
    if not bullish:
        log.warning("sotd.no_candidates", today=today)
        return None

    # Cross-reference with scanner
    scanner_hits: dict[str, list[str]] = {}
    for scan_id in ("momentum", "high_volume_breakout", "price_breakout"):
        try:
            resp = await run_market_scan(scan_id, limit=20)
            for r in resp.get("results", []):
                sym = r.get("symbol", "")
                if sym:
                    scanner_hits.setdefault(sym, []).append(scan_id)
        except Exception as exc:
            log.warning("sotd.scanner_skip", scan=scan_id, error=str(exc))

    # Score each candidate
    scored: list[tuple[float, object]] = []
    for c in bullish:
        hits = scanner_hits.get(c.symbol, [])
        scanner_bonus = len(hits) * 8
        sig_bonus = 12 if c.signal == "STRONG_BUY" else 5
        composite = min(100.0, c.score + scanner_bonus + sig_bonus)
        scored.append((composite, c))

    scored.sort(reverse=True, key=lambda x: x[0])
    composite_score, winner = scored[0]

    from app.domain.models.discovery import StockScore
    w: StockScore = winner  # type: ignore[assignment]

    targets: list[float] = w.targets if w.targets else []
    target = targets[0] if targets else round(w.entry_price * 1.05, 2)

    return StockOfDay(
        date=today,
        generated_at=datetime.utcnow().isoformat(),
        symbol=w.symbol,
        name=w.name,
        sector=getattr(w, "sector", ""),
        discovery_score=w.score,
        discovery_signal=w.signal,
        scanner_hits=scanner_hits.get(w.symbol, []),
        forecast_direction="N/A",
        composite_score=round(composite_score, 1),
        confidence=round(composite_score / 100, 3),
        entry_price=w.entry_price,
        stop_loss=w.stop_loss,
        target=target,
        risk_reward=w.risk_reward_ratio,
        holding_period=w.holding_period,
        explanation=w.explanation,
    )


# ── Auto trade ────────────────────────────────────────────────────────────────

async def _auto_place_trade(sotd: StockOfDay, cfg) -> None:  # type: ignore[type-arg]
    """Place a paper trade for the first active admin user."""
    from app.infra.db.repositories.stock_of_day_repo import StockOfDayRepository

    log.info(
        "sotd.auto_trade.evaluating",
        symbol=sotd.symbol,
        composite_score=sotd.composite_score,
        threshold=cfg.threshold,
        score_passes=sotd.composite_score >= cfg.threshold,
        auto_trade_enabled=cfg.auto_trade_enabled,
        market_hours_only=cfg.market_hours_only,
        max_daily_trades=cfg.max_daily_trades,
    )

    # Check market hours
    if cfg.market_hours_only:
        now_ist = datetime.now(IST)
        hm = now_ist.hour * 100 + now_ist.minute
        weekday = now_ist.weekday()  # 0=Mon, 6=Sun
        day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        market_open = weekday < 5 and 915 <= hm <= 1530
        if not market_open:
            log.warning(
                "sotd.auto_trade.blocked",
                reason="market_closed",
                symbol=sotd.symbol,
                ist_time=now_ist.strftime("%H:%M"),
                day=day_names[weekday],
                hhmm=hm,
                rule="market_hours_only=True requires weekday 9:15–15:30 IST",
            )
            return
        log.info(
            "sotd.auto_trade.market_check_passed",
            ist_time=now_ist.strftime("%H:%M"),
            day=day_names[weekday],
        )

    # Enforce max daily trades
    today = datetime.now(IST).strftime("%Y-%m-%d")
    repo = StockOfDayRepository()
    trades_today = await repo.count_auto_trades_today(today)
    if trades_today >= cfg.max_daily_trades:
        log.warning(
            "sotd.auto_trade.blocked",
            reason="daily_limit_reached",
            symbol=sotd.symbol,
            trades_today=trades_today,
            limit=cfg.max_daily_trades,
            rule=f"max_daily_trades={cfg.max_daily_trades} already reached for {today}",
        )
        return
    log.info(
        "sotd.auto_trade.daily_check_passed",
        trades_today=trades_today,
        limit=cfg.max_daily_trades,
    )

    try:
        from app.core.config import settings
        from app.domain.models.trade import Trade, TradeMode, TradeSignal, TradeStatus
        from app.infra.db.repositories.trade_repo import SQLTradeRepository
        from app.infra.db.models import UserORM
        from sqlalchemy import select
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

        engine = create_async_engine(settings.DATABASE_URL)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

        async with Session() as session:
            # Find first active admin user
            result = await session.execute(
                select(UserORM)
                .where(UserORM.role == "admin", UserORM.is_active.is_(True))
                .limit(1)
            )
            admin_orm = result.scalar_one_or_none()
            if admin_orm is None:
                # Fall back to any active user
                result = await session.execute(
                    select(UserORM).where(UserORM.is_active.is_(True)).limit(1)
                )
                admin_orm = result.scalar_one_or_none()

            if admin_orm is None:
                log.warning("sotd.auto_trade.no_user")
                await engine.dispose()
                return

            if cfg.quantity_type == "pct":
                # qty = floor(capital × pct% / entry_price), minimum 1
                qty = max(1, int(cfg.paper_capital * cfg.paper_trade_quantity / 100 / sotd.entry_price))
                log.info("sotd.auto_trade.qty_calc",
                         mode="pct", pct=cfg.paper_trade_quantity,
                         capital=cfg.paper_capital, entry=sotd.entry_price, qty=qty)
            else:
                qty = max(1, int(cfg.paper_trade_quantity))
            trade = Trade(
                user_id=admin_orm.id,
                symbol=sotd.symbol,
                exchange="NSE",
                signal=TradeSignal.BUY,
                entry_price=sotd.entry_price,
                stop_loss=sotd.stop_loss,
                target=sotd.target,
                quantity=qty,
                mode=TradeMode.PAPER,
                status=TradeStatus.OPEN,
                opened_at=datetime.utcnow(),
                ai_confidence=sotd.confidence,
                ai_explanation=f"SotD auto-trade · composite score {sotd.composite_score:.1f}",
            )

            repo = SQLTradeRepository(session)
            saved = await repo.create(trade)

        sotd.auto_traded = True
        sotd.paper_trade_id = str(saved.id)
        sotd.auto_trade_user_id = str(admin_orm.id)
        sotd.quantity = qty
        sotd.status = "TRADING"

        await engine.dispose()
        log.info(
            "sotd.auto_trade.placed",
            symbol=sotd.symbol,
            trade_id=sotd.paper_trade_id,
            entry=sotd.entry_price,
            sl=sotd.stop_loss,
            target=sotd.target,
        )

        await _send_auto_trade_email(sotd)

    except Exception as exc:
        log.error("sotd.auto_trade.error", error=str(exc))


async def _close_paper_trade(trade_id: str, exit_price: float) -> None:
    """Close the linked paper trade at the given price."""
    try:
        from uuid import UUID
        from app.core.config import settings
        from app.domain.models.trade import TradeStatus
        from app.infra.db.repositories.trade_repo import SQLTradeRepository
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

        engine = create_async_engine(settings.DATABASE_URL)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

        async with Session() as session:
            repo = SQLTradeRepository(session)
            trade = await repo.get_by_id(UUID(trade_id))
            if trade and trade.status == TradeStatus.OPEN:
                trade.exit_price = exit_price
                trade.closed_at = datetime.utcnow()
                trade.status = TradeStatus.CLOSED
                await repo.update(trade)

        await engine.dispose()
        log.info("sotd.paper_trade.closed", trade_id=trade_id, exit_price=exit_price)
    except Exception as exc:
        log.error("sotd.paper_trade.close_error", error=str(exc))


# ── SotD watchlist ───────────────────────────────────────────────────────────

async def _add_to_sotd_watchlist(sotd: StockOfDay) -> None:
    """Ensure a 'Stock of the Day' watchlist exists for every admin user
    and add today's pick to it (skip if already present)."""
    try:
        from uuid import uuid4 as _uuid4
        from app.core.config import settings
        from app.infra.db.models import UserORM
        from sqlalchemy import select, text
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

        engine = create_async_engine(settings.DATABASE_URL)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

        async with Session() as session:
            result = await session.execute(
                select(UserORM).where(UserORM.is_active.is_(True))
            )
            users = result.scalars().all()

            for user in users:
                uid = str(user.id)

                # Find or create the "Stock of the Day" watchlist
                wl_row = await session.execute(
                    text("SELECT id FROM watchlists WHERE user_id = :uid AND name = 'Stock of the Day' LIMIT 1"),
                    {"uid": uid},
                )
                wl = wl_row.fetchone()
                if wl is None:
                    wl_id = str(_uuid4())
                    await session.execute(
                        text("INSERT INTO watchlists (id, user_id, name, created_at) VALUES (:id, :uid, 'Stock of the Day', NOW())"),
                        {"id": wl_id, "uid": uid},
                    )
                else:
                    wl_id = str(wl[0])

                # Add the symbol (skip if already there)
                await session.execute(
                    text("""
                        INSERT INTO watchlist_items (id, user_id, watchlist_id, symbol, exchange, added_at)
                        VALUES (:id, :uid, :wlid, :sym, 'NSE', NOW())
                        ON CONFLICT DO NOTHING
                    """),
                    {"id": str(_uuid4()), "uid": uid, "wlid": wl_id, "sym": sotd.symbol},
                )

            await session.commit()

        await engine.dispose()
        log.info("sotd.watchlist.updated", symbol=sotd.symbol)
    except Exception as exc:
        log.warning("sotd.watchlist.error", error=str(exc))


# ── Email notifications ───────────────────────────────────────────────────────

async def _get_recipients() -> list[str]:
    from app.core.config import settings
    from app.infra.db.repositories.email_list_repo import EmailListRepository
    email_repo = EmailListRepository()
    managed = await email_repo.list_active_emails()
    fallback = settings.REPORT_TO_EMAIL or settings.SMTP_USER
    return managed if managed else ([fallback] if fallback else [])


async def _send_sotd_pick_email(sotd: StockOfDay) -> None:
    from app.infra.email.client import send_email
    recipients = await _get_recipients()
    if not recipients:
        return

    sym = sotd.symbol.replace(".NS", "").replace(".BO", "")
    score_color = "#059669" if sotd.composite_score >= 85 else "#4f46e5"
    auto_badge = (
        f'<div style="margin-top:16px;padding:12px;background:#ecfdf5;border-radius:8px;border-left:4px solid #059669;">'
        f'<p style="margin:0;font-size:13px;font-weight:700;color:#065f46;">✅ Auto-Trade Placed</p>'
        f'<p style="margin:4px 0 0;font-size:12px;color:#065f46;">A paper trade was automatically placed at ₹{sotd.entry_price:,.2f} with SL ₹{sotd.stop_loss:,.2f} and Target ₹{sotd.target:,.2f}</p>'
        f'</div>'
    ) if sotd.auto_traded else (
        f'<div style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:8px;border-left:4px solid #d97706;">'
        f'<p style="margin:0;font-size:13px;color:#78350f;">⚠ Confidence {sotd.composite_score:.0f}/100 — below 85 threshold, no auto-trade placed. Review manually.</p>'
        f'</div>'
    )

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:24px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.7);">Manju Trade AI Pro</p>
    <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#fff;">⭐ Stock of the Day</h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">{sotd.date}</p>
  </div>
  <div style="padding:28px 32px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div>
        <p style="margin:0;font-size:24px;font-weight:800;color:#111827;">{sym}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">{sotd.name} &nbsp;·&nbsp; {sotd.sector}</p>
      </div>
      <div style="text-align:right;">
        <p style="margin:0;font-size:28px;font-weight:800;color:{score_color};">{sotd.composite_score:.0f}</p>
        <p style="margin:0;font-size:10px;text-transform:uppercase;color:#9ca3af;">Composite Score</p>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 0;color:#6b7280;">Entry Price</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#111827;text-align:right;">₹{sotd.entry_price:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Stop Loss</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#dc2626;text-align:right;">₹{sotd.stop_loss:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Target</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#059669;text-align:right;">₹{sotd.target:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Risk:Reward</td>
          <td style="padding:6px 0;font-weight:700;color:#4f46e5;text-align:right;">{sotd.risk_reward:.2f}x</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Holding Period</td>
          <td style="padding:6px 0;text-align:right;">{sotd.holding_period}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Scanner Hits</td>
          <td style="padding:6px 0;text-align:right;color:#4f46e5;">{", ".join(sotd.scanner_hits) or "—"}</td></tr>
    </table>
    <div style="margin-top:16px;padding:14px;background:#f9fafb;border-radius:8px;">
      <p style="margin:0;font-size:12px;color:#374151;">{sotd.explanation[:400]}{"..." if len(sotd.explanation) > 400 else ""}</p>
    </div>
    {auto_badge}
  </div>
</div>
</body></html>"""

    subject = f"⭐ SotD: {sym} · Score {sotd.composite_score:.0f} · {sotd.date}"
    for to in recipients:
        try:
            await send_email(to=to, subject=subject, html=html)
        except Exception as exc:
            log.warning("sotd.email.failed", to=to, error=str(exc))


async def _send_auto_trade_email(sotd: StockOfDay) -> None:
    from app.infra.email.client import send_email
    recipients = await _get_recipients()
    if not recipients:
        return

    sym = sotd.symbol.replace(".NS", "").replace(".BO", "")
    pct_sl  = (sotd.stop_loss  - sotd.entry_price) / sotd.entry_price * 100
    pct_tgt = (sotd.target     - sotd.entry_price) / sotd.entry_price * 100

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
  <div style="background:#059669;padding:24px 32px;">
    <h1 style="margin:0;font-size:20px;font-weight:700;color:#fff;">🤖 Auto-Trade Executed</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">{sotd.date} · Confidence {sotd.composite_score:.1f}/100</p>
  </div>
  <div style="padding:28px 32px;">
    <p style="font-size:14px;color:#374151;margin-bottom:16px;">
      A paper BUY trade was automatically placed for <strong>{sym}</strong> based on a composite confidence score of <strong>{sotd.composite_score:.1f}/100</strong> (threshold: 85).
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 0;color:#6b7280;">Symbol</td>
          <td style="padding:6px 0;font-weight:700;color:#111827;text-align:right;">{sym} (BUY · PAPER)</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Entry Price</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;text-align:right;">₹{sotd.entry_price:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Stop Loss</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#dc2626;text-align:right;">₹{sotd.stop_loss:,.2f} ({pct_sl:+.1f}%)</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Target</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#059669;text-align:right;">₹{sotd.target:,.2f} ({pct_tgt:+.1f}%)</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Qty</td>
          <td style="padding:6px 0;text-align:right;">{sotd.quantity}</td></tr>
    </table>
    <div style="margin-top:20px;padding:12px;background:#f0fdf4;border-radius:8px;border-left:4px solid #059669;">
      <p style="margin:0;font-size:12px;color:#065f46;">The position will be auto-closed when the stop loss or target is hit. You will receive an email notification immediately.</p>
    </div>
  </div>
</div>
</body></html>"""

    subject = f"🤖 Auto-Trade: BUY {sym} @ ₹{sotd.entry_price:,.2f}"
    for to in recipients:
        try:
            await send_email(to=to, subject=subject, html=html)
        except Exception as exc:
            log.warning("sotd.auto_trade.email.failed", to=to, error=str(exc))


async def _send_sotd_event_email(sotd: StockOfDay, event: str) -> None:
    from app.infra.email.client import send_email
    recipients = await _get_recipients()
    if not recipients:
        return

    sym = sotd.symbol.replace(".NS", "").replace(".BO", "")
    pnl = sotd.pnl_pct or 0.0

    if event == "TARGET_HIT":
        emoji, title, color, msg = "🎯", "Target Hit — Profit Booked!", "#059669", "Congratulations! The position has been auto-closed at the target price."
    elif event == "STOP_HIT":
        emoji, title, color, msg = "⛔", "Stop Loss Triggered — Loss Limited", "#dc2626", "The position has been auto-closed at the stop loss price to limit further downside."
    else:
        emoji, title, color = "🔔", "Position Expired at Market Close", "#6b7280"
        msg = "Trading day ended without SL/target trigger. Position closed at CMP."

    pnl_color = "#059669" if pnl >= 0 else "#dc2626"
    pnl_sign = "+" if pnl >= 0 else ""

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
  <div style="background:{color};padding:24px 32px;">
    <h1 style="margin:0;font-size:20px;font-weight:700;color:#fff;">{emoji} {title}</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">SotD {sotd.date} · {sym}</p>
  </div>
  <div style="padding:28px 32px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 0;color:#6b7280;">Symbol</td>
          <td style="padding:6px 0;font-weight:700;text-align:right;">{sym}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Entry Price</td>
          <td style="padding:6px 0;font-family:monospace;text-align:right;">₹{sotd.entry_price:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Exit Price</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:{color};text-align:right;">₹{(sotd.exit_price or 0):,.2f}</td></tr>
      <tr style="border-top:1px solid #e5e7eb;">
          <td style="padding:10px 0 6px;color:#6b7280;font-weight:600;">P&L</td>
          <td style="padding:10px 0 6px;font-family:monospace;font-weight:800;font-size:18px;color:{pnl_color};text-align:right;">{pnl_sign}{pnl:.2f}%</td></tr>
    </table>
    <div style="margin-top:16px;padding:14px;background:#f9fafb;border-radius:8px;">
      <p style="margin:0;font-size:13px;color:#374151;">{msg}</p>
    </div>
  </div>
</div>
</body></html>"""

    subject = f"{emoji} SotD {event.replace('_', ' ')} — {sym} · {pnl_sign}{pnl:.2f}%"
    for to in recipients:
        try:
            await send_email(to=to, subject=subject, html=html)
        except Exception as exc:
            log.warning("sotd.event.email.failed", to=to, error=str(exc))
