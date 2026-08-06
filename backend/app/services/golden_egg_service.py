"""Golden Egg — a single high-conviction intraday cash-equity pick, emailed
09:15-09:30 IST every NSE trading day.

Reuses the Golden Stock Intraday scanner (technical + fundamental screen,
ATR-sized entry/stop-loss/target, same-session hold -- see
infra/scanner/golden_stock_scanner.py) rather than building a second scoring
engine from scratch. Only the top-ranked candidate is emailed, with a
suggested quantity sized to net roughly `target_profit` rupees at the nearer
target (T1), capped so the position's value never exceeds
settings.PAPER_CAPITAL.

Deliberately doesn't persist anything or place any trade -- this is a
read-only, informational email, separate from Golden Stock Intraday's own
09:30+ scan/save/watchlist pipeline (golden_stock_service.py) and from Stock
of the Day's optional auto-trade (stock_of_day_service.py). Cash equities
only, same universe as Golden Stock Intraday (NIFTY_ALL) -- no F&O/options
are ever considered, so "no options" is satisfied by construction, not by
an extra filter.

Not financial advice: the quantity/profit figures below are illustrative
sizing math for a manual decision, not a guarantee of any outcome. Every
email includes a risk disclaimer -- see infra/email/golden_egg_report.py.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import structlog

from app.infra.scanner.golden_stock_scanner import IntradayCandidate, run_golden_stock_scan

log = structlog.get_logger()

IST = timezone(timedelta(hours=5, minutes=30))


async def send_golden_egg_email(target_profit: float = 1000.0) -> IntradayCandidate | None:
    """Main entry, called by the 09:15 IST scheduler job. Runs a fresh Golden
    Stock Intraday scan, emails the single top pick with a target_profit-sized
    quantity suggestion, and returns that pick (None if no candidate cleared
    the scanner's filters today -- a "no clear setup" email is still sent so
    the 09:15-09:30 email reliably arrives either way).

    Also persists the pick (see infra/db/repositories/golden_egg_repo.py --
    the History tab needs this; the email alone doesn't leave a record) and
    kicks off a day/week/month price forecast for the picked symbol (reuses
    forecast_service.generate_forecast, the same ML ensemble already backing
    the standalone Forecast page -- no separate prediction engine needed for
    those three horizons, only the intraday "1h" one is Golden-Egg-specific,
    see golden_egg_intraday_prediction_service.py)."""
    from app.infra.db.repositories.golden_egg_repo import GoldenEggRepository

    scan = await run_golden_stock_scan()
    market_context = await _get_market_context()
    repo = GoldenEggRepository()

    if not scan.picks:
        await repo.save_pick(scan.scan_date, None, None, target_profit, market_context)
        await _send_no_pick_email(scan.scan_date, market_context)
        log.info("golden_egg.no_pick", date=scan.scan_date)
        return None

    pick = scan.picks[0]
    sizing = _size_for_target(pick, target_profit)
    await repo.save_pick(scan.scan_date, pick, sizing, target_profit, market_context)
    await _send_pick_email(pick, sizing, target_profit, market_context)
    log.info(
        "golden_egg.sent",
        symbol=pick.symbol,
        score=pick.confidence_score,
        qty=sizing["qty"],
        target_profit=target_profit,
    )

    try:
        from app.services.forecast_service import generate_forecast

        await generate_forecast(pick.symbol)
    except Exception as exc:
        log.warning("golden_egg.forecast_seed.failed", symbol=pick.symbol, error=str(exc))

    return pick


# ── Position sizing ──────────────────────────────────────────────────────────


def _size_for_target(pick: IntradayCandidate, target_profit: float) -> dict:
    """Illustrative quantity to net ~target_profit at T1 (the nearer of the
    scanner's two ATR-based targets), capped at settings.PAPER_CAPITAL worth
    of position value. Purely informational math for a manual decision --
    this job never places an order, so it isn't gated by the Risk Engine the
    way real trade execution is (see CLAUDE.md's risk-management rules;
    that gate applies at order placement, which doesn't happen here)."""
    from app.core.config import settings

    per_share_gain = pick.target_1 - pick.entry_price
    if per_share_gain <= 0:
        return {
            "qty": 0,
            "position_value": 0.0,
            "expected_profit": 0.0,
            "max_loss": 0.0,
            "capped": False,
        }

    qty = max(1, math.ceil(target_profit / per_share_gain))
    position_value = qty * pick.entry_price

    capped = False
    max_capital = settings.PAPER_CAPITAL
    if max_capital and position_value > max_capital:
        qty = max(1, int(max_capital / pick.entry_price))
        position_value = qty * pick.entry_price
        capped = True

    return {
        "qty": qty,
        "position_value": round(position_value, 2),
        "expected_profit": round(qty * per_share_gain, 2),
        "max_loss": round(qty * (pick.entry_price - pick.stop_loss), 2),
        "capped": capped,
    }


# ── Market context (best-effort) ─────────────────────────────────────────────


async def _get_market_context() -> str | None:
    """Today's label from this week's rule-based sentiment forecast
    (Bullish/Cautiously Bullish/Neutral/Cautious/Bearish), if one's been
    generated for this week -- see sentiment_forecast_service.py. Purely
    informational context shown alongside the pick; never blocks the email
    or changes which stock is picked if unavailable."""
    try:
        from app.services.sentiment_forecast_service import get_week_view

        view = await get_week_view()
        if not view:
            return None
        today_name = datetime.now(IST).strftime("%A")
        for day in view.get("days", []):
            if day.get("weekday") == today_name:
                label = day.get("forecast_label")
                return str(label) if label else None
        return None
    except Exception as exc:
        log.warning("golden_egg.market_context.error", error=str(exc))
        return None


# ── Email ─────────────────────────────────────────────────────────────────────


async def _get_recipients() -> list[str]:
    from app.core.config import settings
    from app.infra.db.repositories.email_list_repo import EmailListRepository

    email_repo = EmailListRepository()
    managed = await email_repo.list_active_emails()
    fallback = settings.REPORT_TO_EMAIL or settings.SMTP_USER
    return managed if managed else ([fallback] if fallback else [])


async def _send_pick_email(
    pick: IntradayCandidate, sizing: dict, target_profit: float, market_context: str | None
) -> None:
    from app.infra.email.client import send_email
    from app.infra.email.golden_egg_report import golden_egg_pick_html

    recipients = await _get_recipients()
    if not recipients:
        log.warning("golden_egg.email.no_recipients")
        return

    html = golden_egg_pick_html(pick, sizing, target_profit, market_context)
    sym = pick.symbol.replace(".NS", "").replace(".BO", "")
    today = datetime.now(IST).strftime("%Y-%m-%d")
    subject = f"\U0001f95a Golden Egg: {sym} · Target ~₹{sizing['expected_profit']:,.0f} · {today}"
    for to in recipients:
        try:
            await send_email(to=to, subject=subject, html=html)
        except Exception as exc:
            log.warning("golden_egg.email.failed", to=to, error=str(exc))


async def _send_no_pick_email(scan_date: str, market_context: str | None) -> None:
    from app.infra.email.client import send_email
    from app.infra.email.golden_egg_report import golden_egg_no_pick_html

    recipients = await _get_recipients()
    if not recipients:
        return

    html = golden_egg_no_pick_html(scan_date, market_context)
    subject = f"\U0001f95a Golden Egg: No clear setup today · {scan_date}"
    for to in recipients:
        try:
            await send_email(to=to, subject=subject, html=html)
        except Exception as exc:
            log.warning("golden_egg.no_pick_email.failed", to=to, error=str(exc))
