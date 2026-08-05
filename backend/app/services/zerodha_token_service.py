"""Daily Zerodha token handling: auto-login where opted in, reminder as the
fallback everywhere else.

Kite invalidates yesterday's access_token once a day regardless of this
app's own Redis session TTL, and there is no official refresh-token API --
by default the user has to click through Kite's login flow again (see
AskUserQuestion answer "Daily reminder + one-click reconnect", the original
default this module implemented). `run_scheduled_auto_login` below is the
opt-in upgrade to that: for users who've saved credentials via
POST /broker/zerodha/auto-login, it replays Kite's login flow unattended
(app/infra/brokers/zerodha_autologin.py) each morning. `check_and_notify_all`
remains the safety net -- it runs afterward and reminds anyone whose session
is still invalid, whether they never opted into auto-login or their
auto-login attempt itself failed (bad TOTP secret, Kite changed the login
flow, etc.).
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
            "Today's Zerodha session is missing or expired. Reconnect to place live "
            "trades on your own account -- and if this is the account other users' "
            "MCX/NSE market data relies on, reconnect promptly to keep it fresh.",
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


async def run_scheduled_auto_login() -> tuple[int, int, int]:
    """Runs unattended auto-login (app/infra/brokers/zerodha_autologin.py)
    for every user who's saved credentials and has it enabled. Meant to run
    shortly before check_and_notify_all each morning -- a user who succeeds
    here never sees a reminder; a user whose auto-login fails (or who never
    opted in) still gets caught by the existing validity check + reminder.

    Returns (attempted, succeeded, failed). Never raises -- a single user's
    failure (bad password, stale TOTP secret, Kite changed its login flow)
    is logged and skipped, not allowed to block everyone else's login."""
    from app.core.config import settings
    from app.infra.brokers import session_store
    from app.infra.brokers.zerodha import ZerodhaBroker
    from app.infra.brokers.zerodha_autologin import ZerodhaAutoLoginError, auto_login
    from app.infra.db.repositories.zerodha_auto_login_repo import SQLZerodhaAutoLoginRepository
    from app.infra.db.session import AsyncSessionLocal

    if not settings.KITE_API_KEY or not settings.KITE_API_SECRET:
        log.info("zerodha_autologin.scheduled.skipped", reason="kite_api_key_not_configured")
        return 0, 0, 0

    async with AsyncSessionLocal() as session:
        repo = SQLZerodhaAutoLoginRepository(session)
        creds = await repo.list_enabled()

        attempted, succeeded, failed = 0, 0, 0
        for cred in creds:
            attempted += 1
            try:
                access_token = await auto_login(
                    settings.KITE_API_KEY,
                    settings.KITE_API_SECRET,
                    cred.kite_user_id,
                    cred.password,
                    cred.totp_secret,
                )
                broker = ZerodhaBroker(api_key=settings.KITE_API_KEY, access_token=access_token)
                await session_store.set_broker(str(cred.user_id), broker)
                await repo.mark_result(cred.user_id, True)
                succeeded += 1
            except ZerodhaAutoLoginError as exc:
                log.warning(
                    "zerodha_autologin.scheduled.failed", user_id=str(cred.user_id), error=str(exc)
                )
                await repo.mark_result(cred.user_id, False)
                failed += 1
            except Exception as exc:
                log.error(
                    "zerodha_autologin.scheduled.error", user_id=str(cred.user_id), error=str(exc)
                )
                await repo.mark_result(cred.user_id, False)
                failed += 1

    log.info(
        "zerodha_autologin.scheduled.done", attempted=attempted, succeeded=succeeded, failed=failed
    )
    return attempted, succeeded, failed
