"""Live signal for the RSI-14 Reversion strategy (oversold=20/overbought=80,
SL 2.5%/target 5.0%/trailing stop 2.0%, 5-minute candles) -- the AI Strategy
Lab's #1 ranked, walk-forward-validated candidate for Natural Gas Mini
specifically (see domain/services/strategy_lab/rsi_reversion_live.py for the
replay logic this wraps, and rsi_reversion_v2.RSI_REVERSION_VERSIONS for the
v1.0 long-only / v2.0 long+short param sets).

get_live_rsi_signal() is deliberately stateless / no persistence:
compute_live_state() replays the whole recent candle history on every call,
so "is a position currently open" falls out of the replay itself rather than
needing a stored position record.

sync_and_alert_rsi_signal() is the one place this module DOES persist
anything -- purely to dedup email/push alerts (see RsiSignalAlertRepository):
without it, the 5-min scheduler poll would re-send the same "new signal"
alert on every tick for as long as a position stays open.
"""

from __future__ import annotations

from datetime import datetime

import structlog

from app.domain.models.historical_candle import HistoricalCandle
from app.domain.services.strategy_lab import rsi_reversion_live as strat
from app.domain.services.strategy_lab.rsi_reversion_v2 import RSI_REVERSION_VERSIONS
from app.infra.db.repositories.mcx_rsi_signal_alert_repo import RsiSignalAlertRepository
from app.services.mcx_service import get_history

log = structlog.get_logger()

RSI_SIGNAL_CONTRACT = "NGMINI"

# Quick kill switch, mirroring mcx_signal_service.MCX_SIGNAL_ALERT_EMAILS_ENABLED.
RSI_SIGNAL_ALERT_EMAILS_ENABLED = True


def _to_candles(bars: list[dict]) -> list[HistoricalCandle]:
    return [
        HistoricalCandle(
            symbol=RSI_SIGNAL_CONTRACT,
            exchange="MCX",
            interval="5minute",
            time=datetime.utcfromtimestamp(b["time"]),
            open=b["open"],
            high=b["high"],
            low=b["low"],
            close=b["close"],
            volume=b["volume"],
        )
        for b in bars
    ]


def _serialize_trade(t: strat.LiveTrade) -> dict:
    return {
        "direction": t.direction,
        "entry_time": t.entry_time.isoformat(),
        "entry_price": t.entry_price,
        "exit_time": t.exit_time.isoformat(),
        "exit_price": t.exit_price,
        "exit_reason": t.exit_reason,
        "pnl": t.pnl,
        "pnl_pct": t.pnl_pct,
    }


def _serialize(version: str, state: strat.LiveSignalState, trades: list[strat.LiveTrade]) -> dict:
    allow_short = RSI_REVERSION_VERSIONS[version].allow_short
    return {
        "contract": RSI_SIGNAL_CONTRACT,
        "version": version,
        "strategy": (
            "RSI-14 Reversion (20/80, SL 2.5% / TG 5.0% / trail 2.0%, long+short)"
            if allow_short
            else "RSI-14 Reversion (20/80, SL 2.5% / TG 5.0% / trail 2.0%, long-only)"
        ),
        "interval": "5minute",
        "status": state.status,
        "direction": state.direction,
        "rsi": round(state.rsi, 2) if state.rsi is not None else None,
        "as_of": state.as_of.isoformat(),
        "position": (
            {
                "direction": state.direction,
                "entry_time": state.entry_time.isoformat() if state.entry_time else None,
                "entry_price": state.entry_price,
                "stop_loss": state.stop_loss,
                "target": state.target,
                "trailing_stop": state.trailing_stop,
            }
            if state.status == "IN_POSITION"
            else None
        ),
        "last_signal": (
            {
                "type": state.last_signal,
                "time": state.last_signal_time.isoformat() if state.last_signal_time else None,
                "price": state.last_signal_price,
                "exit_reason": state.last_exit_reason,
            }
            if state.last_signal is not None
            else None
        ),
        # v3.0 filters -- True only when an RSI entry condition is met right
        # now but held back by the Time or Volatility filter (see
        # rsi_reversion_v2.RsiReversionParams).
        "blocked_by_time_filter": state.blocked_by_time_filter,
        "blocked_by_volatility_filter": state.blocked_by_volatility_filter,
        # Trades completed within the fetched lookback window (~15 days of
        # 5-min candles, see mcx_service._HISTORY_PERIOD_MAP["5m"]) -- not
        # persisted anywhere, just the same replay's own trade log, most
        # recent first.
        "recent_trades": [_serialize_trade(t) for t in reversed(trades)],
    }


async def _compute(user_id: str, version: str, capital: float) -> tuple[strat.LiveSignalState, list[strat.LiveTrade]]:
    if version not in RSI_REVERSION_VERSIONS:
        raise ValueError(f"Unknown RSI Reversion version '{version}' -- expected one of "
                          f"{list(RSI_REVERSION_VERSIONS)}")
    bars = await get_history(user_id, "5m", RSI_SIGNAL_CONTRACT)
    candles = _to_candles(bars)
    return strat.compute_live_state(candles, capital, RSI_REVERSION_VERSIONS[version])


async def get_live_rsi_signal(user_id: str, capital: float = 100_000.0, version: str = "v1.0") -> dict:
    state, trades = await _compute(user_id, version, capital)
    return _serialize(version, state, trades)


async def _send_rsi_signal_alert(user_id: str, version: str, state: strat.LiveSignalState) -> None:
    """In-app notification + high-priority email for a new RSI Reversion
    entry -- same actionable/time-sensitive treatment as
    mcx_signal_service._send_signal_alert, dedicated copy since this isn't
    the NG-AI Pro score system."""
    assert state.direction is not None and state.entry_price is not None
    direction_label = "BUY" if state.direction == "LONG" else "SELL"

    try:
        from app.infra.notifications.push import fire as notif_fire

        notif_fire(
            user_id,
            "mcx.rsi_signal_alert",
            f"Natural Gas Mini {direction_label} Signal — RSI Reversion {version}",
            f"Entry {state.entry_price:.2f} · SL {state.stop_loss:.2f} · Target {state.target:.2f}",
            "/mcx?contract=NGMINI&tab=rsi-strategy",
        )
    except Exception as exc:
        log.warning("mcx.rsi_signal_alert.notif_failed", error=str(exc))

    if not RSI_SIGNAL_ALERT_EMAILS_ENABLED:
        return

    try:
        from uuid import UUID

        from app.infra.db.repositories.user_repo import SQLUserRepository
        from app.infra.db.session import AsyncSessionLocal
        from app.infra.email.client import send_email
        from app.infra.email.rsi_signal_alert_report import rsi_signal_alert_html

        async with AsyncSessionLocal() as session:
            user = await SQLUserRepository(session).get_by_id(UUID(user_id))
        if user is None:
            return

        html = rsi_signal_alert_html(
            RSI_SIGNAL_CONTRACT,
            direction_label,
            version,
            state.rsi,
            state.entry_price,
            state.stop_loss,  # type: ignore[arg-type]
            state.target,  # type: ignore[arg-type]
        )
        subject = f"Natural Gas Mini {direction_label} Signal (RSI Reversion {version}) — Entry {state.entry_price:.2f}"
        await send_email(to=user.email, subject=subject, html=html, priority=True)
        log.info("mcx.rsi_signal_alert.sent", user_id=user_id, version=version, direction=state.direction)
    except Exception as exc:
        log.warning("mcx.rsi_signal_alert.email_failed", error=str(exc))


async def sync_and_alert_rsi_signal(
    user_id: str, version: str, alert_repo: RsiSignalAlertRepository, capital: float = 100_000.0
) -> bool:
    """Called by the scheduler every 5 min: computes the live state and, if
    it's a genuinely new entry (different entry_time/direction than the last
    one alerted for this user/version), sends the BUY/SELL + SL/target alert
    and records it so the next poll doesn't re-send while the position stays
    open. Returns True if a new alert was sent."""
    state, _ = await _compute(user_id, version, capital)
    if state.status != "IN_POSITION" or state.entry_time is None:
        return False

    marker = await alert_repo.get(user_id, RSI_SIGNAL_CONTRACT, version)
    already_alerted = (
        marker is not None
        and marker.get("direction") == state.direction
        and marker.get("entry_time") == state.entry_time
    )
    if already_alerted:
        return False

    await _send_rsi_signal_alert(user_id, version, state)
    await alert_repo.mark_alerted(
        user_id, RSI_SIGNAL_CONTRACT, version, state.direction, state.entry_time  # type: ignore[arg-type]
    )
    return True


async def _send_blocked_signal_notice(user_id: str, version: str, reason: str) -> None:
    """Informational, normal-priority (not the high-priority treatment an
    actual BUY/SELL gets) -- this is "here's why nothing happened", not an
    actionable call. Kept as an inline HTML string rather than a dedicated
    report file since it's a single line of content, unlike the multi-field
    signal alert emails."""
    reason_label = "an upcoming EIA Natural Gas Storage Report" if reason == "TIME_FILTER" else "extreme ATR volatility"

    try:
        from app.infra.notifications.push import fire as notif_fire

        notif_fire(
            user_id,
            "mcx.rsi_signal_blocked",
            f"Natural Gas Mini — RSI Reversion {version} entry held back",
            f"An RSI entry condition fired but was skipped due to {reason_label}.",
            "/mcx?contract=NGMINI&tab=rsi-strategy",
        )
    except Exception as exc:
        log.warning("mcx.rsi_signal_blocked.notif_failed", error=str(exc))

    if not RSI_SIGNAL_ALERT_EMAILS_ENABLED:
        return

    try:
        from uuid import UUID

        from app.infra.db.repositories.user_repo import SQLUserRepository
        from app.infra.db.session import AsyncSessionLocal
        from app.infra.email.client import send_email

        async with AsyncSessionLocal() as session:
            user = await SQLUserRepository(session).get_by_id(UUID(user_id))
        if user is None:
            return

        html = (
            "<!DOCTYPE html><html><body style=\"font-family:Arial,sans-serif;padding:24px;\">"
            f"<h2>RSI Reversion {version} — Entry Held Back</h2>"
            f"<p>An RSI-14 entry condition fired on Natural Gas Mini, but the trade was skipped "
            f"due to <strong>{reason_label}</strong>.</p>"
            "<p style=\"color:#6b7280;font-size:12px;\">This is informational, not an actionable "
            "signal -- see the MCX page's RSI Strategy tab for the live state.</p>"
            "</body></html>"
        )
        await send_email(
            to=user.email,
            subject=f"Natural Gas Mini — RSI Reversion {version} entry held back ({reason_label})",
            html=html,
            priority=False,
        )
        log.info("mcx.rsi_signal_blocked.sent", user_id=user_id, version=version, reason=reason)
    except Exception as exc:
        log.warning("mcx.rsi_signal_blocked.email_failed", error=str(exc))


async def sync_and_alert_blocked_signal(
    user_id: str, version: str, alert_repo: RsiSignalAlertRepository, capital: float = 100_000.0
) -> bool:
    """Called by the scheduler every 5 min: if an RSI entry condition is
    firing right now but the Time or Volatility filter (v3.0) is holding it
    back, notify once per calendar day -- not once per position (there's no
    position to key on), so a day-granularity dedup key under a distinct
    "<contract>_BLOCKED" tag reuses RsiSignalAlertRepository without a schema
    change. Returns True if a new notice was sent."""
    state, _ = await _compute(user_id, version, capital)
    if not (state.blocked_by_time_filter or state.blocked_by_volatility_filter):
        return False

    reason = "TIME_FILTER" if state.blocked_by_time_filter else "VOLATILITY_FILTER"
    day_key = datetime(state.as_of.year, state.as_of.month, state.as_of.day)
    contract_key = f"{RSI_SIGNAL_CONTRACT}_BLOCKED"

    marker = await alert_repo.get(user_id, contract_key, version)
    already_alerted = (
        marker is not None and marker.get("direction") == reason and marker.get("entry_time") == day_key
    )
    if already_alerted:
        return False

    await _send_blocked_signal_notice(user_id, version, reason)
    await alert_repo.mark_alerted(user_id, contract_key, version, reason, day_key)
    return True
