"""Position monitor — checks every open paper trade against the current market price.

Runs every 5 minutes during market hours via APScheduler.
Fires an email alert (and stores a PositionAlert) the first time a stop loss
or profit target is breached. Duplicate suppression is done via an in-memory
set — so alerts reset if the server restarts, which is acceptable for paper trading.
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4

import structlog

log = structlog.get_logger()

# ── Seen-alert dedup set: (trade_id, event) ──────────────────────────────────
_seen: set[tuple[str, str]] = set()


@dataclass
class PositionAlert:
    user_id: str
    trade_id: str
    symbol: str
    signal: str          # "BUY" | "SELL"
    event: str           # "stop_hit" | "target_hit"
    entry_price: float
    stop_loss: float
    target: float
    trigger_price: float
    quantity: int
    pnl_estimate: float  # unrealised P&L at trigger price
    id: str = field(default_factory=lambda: str(uuid4()))
    triggered_at: datetime = field(default_factory=datetime.utcnow)
    acknowledged: bool = False


# user_id → list[PositionAlert]  (module-level, survives across requests)
_store: dict[str, list[PositionAlert]] = {}


def get_position_alerts(user_id: str) -> list[PositionAlert]:
    return _store.get(user_id, [])


def ack_position_alert(user_id: str, alert_id: str) -> bool:
    for a in _store.get(user_id, []):
        if a.id == alert_id:
            a.acknowledged = True
            return True
    return False


def clear_position_alert(user_id: str, alert_id: str) -> bool:
    alerts = _store.get(user_id, [])
    before = len(alerts)
    _store[user_id] = [a for a in alerts if a.id != alert_id]
    return len(_store[user_id]) < before


def _pnl(signal: str, entry: float, current: float, qty: int) -> float:
    if signal == "BUY":
        return round((current - entry) * qty, 2)
    return round((entry - current) * qty, 2)


async def _send_position_email(alert: PositionAlert) -> None:
    from app.core.config import settings
    from app.infra.email.client import send_email

    to = settings.REPORT_TO_EMAIL or settings.SMTP_USER
    if not to:
        return

    if alert.event == "stop_hit":
        emoji, title = "⚠️", "Stop Loss Hit"
        color = "#dc2626"
        action = "Consider closing the position to limit further losses."
    else:
        emoji, title = "🎯", "Target Reached"
        color = "#059669"
        action = "Consider booking profits or adjusting your stop to lock in gains."

    pnl_sign = "+" if alert.pnl_estimate >= 0 else ""
    pnl_color = "#059669" if alert.pnl_estimate >= 0 else "#dc2626"
    sym = alert.symbol.replace(".NS", "").replace(".BO", "")

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
  <div style="background:{color};padding:24px 32px;">
    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.8);">Manju Trade AI Pro · Paper Trade Alert</p>
    <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#fff;">{emoji} {title}</h1>
  </div>
  <div style="padding:28px 32px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 0;color:#6b7280;">Symbol</td>
          <td style="padding:6px 0;font-weight:700;color:#111827;text-align:right;">{sym} ({alert.signal})</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Trigger Price</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:{color};text-align:right;">₹{alert.trigger_price:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Entry Price</td>
          <td style="padding:6px 0;font-family:monospace;text-align:right;">₹{alert.entry_price:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Stop Loss</td>
          <td style="padding:6px 0;font-family:monospace;text-align:right;">₹{alert.stop_loss:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Target</td>
          <td style="padding:6px 0;font-family:monospace;text-align:right;">₹{alert.target:,.2f}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Quantity</td>
          <td style="padding:6px 0;text-align:right;">{alert.quantity}</td></tr>
      <tr style="border-top:1px solid #e5e7eb;">
          <td style="padding:10px 0 6px;color:#6b7280;font-weight:600;">Estimated P&L</td>
          <td style="padding:10px 0 6px;font-family:monospace;font-weight:700;font-size:16px;color:{pnl_color};text-align:right;">{pnl_sign}₹{alert.pnl_estimate:,.2f}</td></tr>
    </table>
    <div style="margin-top:20px;padding:14px;background:#f9fafb;border-radius:8px;border-left:4px solid {color};">
      <p style="margin:0;font-size:13px;color:#374151;">{action}</p>
    </div>
    <p style="margin-top:20px;font-size:11px;color:#9ca3af;">
      Triggered at {alert.triggered_at.strftime('%d %b %Y, %H:%M IST')} · Paper trading only · Not financial advice.
    </p>
  </div>
</div>
</body></html>"""

    subject = f"{emoji} {title} — {sym} | ₹{alert.trigger_price:,.2f}"
    await send_email(to=to, subject=subject, html=html)


async def run_position_check() -> None:
    """Check every open trade against current market prices."""
    from app.core.config import settings
    from app.infra.market_data.yfinance_client import YFinanceClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from app.infra.db.repositories.trade_repo import SQLTradeRepository

    engine = create_async_engine(settings.DATABASE_URL)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    try:
        async with Session() as session:
            repo = SQLTradeRepository(session)
            trades = await repo.list_all_open()

        if not trades:
            await engine.dispose()
            return

        log.info("position_monitor.checking", count=len(trades))

        # Fetch current prices for all unique symbols
        symbols = list({t.symbol for t in trades})
        client = YFinanceClient()
        results = await asyncio.gather(
            *[client.get_quote(s) for s in symbols], return_exceptions=True
        )
        prices: dict[str, float] = {}
        for sym, r in zip(symbols, results, strict=True):
            if not isinstance(r, Exception):
                prices[sym] = r.price

        # Check each trade
        email_tasks = []
        for trade in trades:
            price = prices.get(trade.symbol)
            if price is None:
                continue

            is_buy = trade.signal.value == "BUY"
            stop_hit = is_buy and price <= trade.stop_loss or \
                       not is_buy and price >= trade.stop_loss
            target_hit = is_buy and price >= trade.target or \
                         not is_buy and price <= trade.target

            for event, fired in [("stop_hit", stop_hit), ("target_hit", target_hit)]:
                if not fired:
                    continue
                key = (str(trade.id), event)
                if key in _seen:
                    continue
                _seen.add(key)

                alert = PositionAlert(
                    user_id=str(trade.user_id),
                    trade_id=str(trade.id),
                    symbol=trade.symbol,
                    signal=trade.signal.value,
                    event=event,
                    entry_price=trade.entry_price,
                    stop_loss=trade.stop_loss,
                    target=trade.target,
                    trigger_price=price,
                    quantity=trade.quantity,
                    pnl_estimate=_pnl(trade.signal.value, trade.entry_price, price, trade.quantity),
                )
                _store.setdefault(str(trade.user_id), []).insert(0, alert)
                email_tasks.append(_send_position_email(alert))
                log.info(
                    "position_monitor.alert",
                    symbol=trade.symbol,
                    event=event,
                    price=price,
                    trade_id=str(trade.id),
                )

        if email_tasks:
            await asyncio.gather(*email_tasks, return_exceptions=True)

    except Exception as exc:
        log.error("position_monitor.error", error=str(exc))
    finally:
        await engine.dispose()
