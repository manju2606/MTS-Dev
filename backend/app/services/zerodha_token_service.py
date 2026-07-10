"""Daily Zerodha token-validity check.

Kite invalidates yesterday's access_token once a day regardless of this
app's own Redis session TTL, and there is no official refresh-token API --
the user has to click through Kite's login flow again. This module doesn't
automate that login (would require storing the user's Zerodha password or
TOTP secret, which the user explicitly chose not to do -- see AskUserQuestion
answer "Daily reminder + one-click reconnect"). It only detects an
invalid/missing session each morning and reminds the user, with a direct
link to the manual reconnect page.
"""

from __future__ import annotations

import structlog

log = structlog.get_logger()


async def _notify_reconnect_needed(user_id: str) -> None:
    try:
        from app.infra.notifications.push import fire as notif_fire

        notif_fire(
            user_id,
            "zerodha.token_expired",
            "Zerodha reconnect needed",
            "Today's Zerodha session is missing or expired. MCX quotes, "
            "predictions, and trade signals won't run until you reconnect.",
            "/broker",
        )
    except Exception as exc:
        log.warning("zerodha_token.notify.notif_failed", user_id=user_id, error=str(exc))

    try:
        from uuid import UUID

        from app.infra.db.repositories.user_repo import SQLUserRepository
        from app.infra.db.session import AsyncSessionLocal
        from app.infra.email.client import send_email
        from app.infra.email.zerodha_token_reminder import zerodha_token_reminder_html

        async with AsyncSessionLocal() as session:
            user = await SQLUserRepository(session).get_by_id(UUID(user_id))
        if user is None:
            return

        html = zerodha_token_reminder_html()
        await send_email(to=user.email, subject="Zerodha Reconnect Needed", html=html)
        log.info("zerodha_token.reminder.sent", user_id=user_id)
    except Exception as exc:
        log.warning("zerodha_token.notify.email_failed", user_id=user_id, error=str(exc))


async def check_and_notify_all() -> tuple[int, int]:
    """Validates every connected user's Zerodha session; reminds whoever's is
    dead. Returns (checked, reminded)."""
    from app.infra.brokers import session_store

    user_ids = await session_store.list_connected_user_ids()
    checked, reminded = 0, 0
    for user_id in user_ids:
        checked += 1
        try:
            broker = await session_store.get(user_id)
            valid = broker is not None and await broker.validate_session()  # type: ignore[attr-defined]
        except Exception as exc:
            log.warning("zerodha_token.check.error", user_id=user_id, error=str(exc))
            valid = False
        if not valid:
            await _notify_reconnect_needed(user_id)
            reminded += 1
    return checked, reminded
