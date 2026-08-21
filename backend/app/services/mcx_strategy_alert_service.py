"""Shared new-signal alert sender for the MTS Gold/Silver/NG Strategy
engines -- in-app notification (bell icon, same app.infra.notifications.push
used by mcx_signal_service.py) plus a high-priority email. Called from all
three sibling strategy modules' check_and_log_*_signal whenever a genuinely
new signal is logged (deduped there already -- one open signal per
user/contract/direction).

Shared rather than mirrored per-module: this is pure alert plumbing, not
scoring logic, matching the split mcx_signal_service._send_signal_alert
already establishes -- that function is imported verbatim by
mcx_metals_signal_service.py rather than duplicated, even though the two
modules' scoring logic itself is mirrored/duplicated on purpose."""

from __future__ import annotations

import structlog

log = structlog.get_logger()

# Quick kill switch, mirroring mcx_signal_service.MCX_SIGNAL_ALERT_EMAILS_ENABLED.
STRATEGY_ALERT_EMAILS_ENABLED = True


async def send_strategy_signal_alert(
    user_id: str,
    strategy_name: str,
    contract: str,
    tradingsymbol: str | None,
    score: dict,
    link: str,
) -> None:
    entry = score["entry"]
    signal_label = score["signal_label"]

    try:
        from app.infra.notifications.push import fire as notif_fire

        body = (
            f"{contract} · Entry {entry['entry_price']:.2f} · "
            f"SL {entry['stop_loss']:.2f} · Target {entry['target_1']:.2f}"
        )
        notif_fire(user_id, "mcx.strategy_alert", f"{signal_label} — {strategy_name}", body, link)
    except Exception as exc:
        log.warning("mcx.strategy_alert.notif_failed", error=str(exc))

    if not STRATEGY_ALERT_EMAILS_ENABLED:
        return

    try:
        from uuid import UUID

        from app.infra.db.repositories.user_repo import SQLUserRepository
        from app.infra.db.session import AsyncSessionLocal
        from app.infra.email.client import send_email
        from app.infra.email.mcx_strategy_signal_alert_report import (
            mcx_strategy_signal_alert_html,
        )

        async with AsyncSessionLocal() as session:
            user = await SQLUserRepository(session).get_by_id(UUID(user_id))
        if user is None:
            return

        html = mcx_strategy_signal_alert_html(
            strategy_name,
            contract,
            tradingsymbol or contract,
            signal_label,
            score["score_pct"],
            entry["entry_price"],
            entry["stop_loss"],
            entry["target_1"],
            entry.get("target_2"),
        )
        subject = f"{signal_label} — {strategy_name} {contract} @ {entry['entry_price']:.2f}"
        await send_email(to=user.email, subject=subject, html=html, priority=True)
        log.info("mcx.strategy_alert.email_sent", user_id=user_id, contract=contract)
    except Exception as exc:
        log.warning("mcx.strategy_alert.email_failed", error=str(exc))
