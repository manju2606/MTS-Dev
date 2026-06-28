"""Thin email client — uses Resend if RESEND_API_KEY is configured, logs otherwise."""

import structlog

logger = structlog.get_logger()


async def send_email(*, to: str, subject: str, html: str) -> None:
    try:
        from app.core.config import settings
        api_key = getattr(settings, "RESEND_API_KEY", None)
    except Exception:
        api_key = None

    if api_key:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "from": "Manju Trade AI Pro <noreply@mts.app>",
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
                timeout=10,
            )
            if resp.status_code >= 400:
                logger.warning("email_send_failed", status=resp.status_code, to=to)
    else:
        logger.info("email_dev_log", to=to, subject=subject)
