"""Email sender — tries SMTP first, then Resend API, then logs to stdout.

Priority:
  1. SMTP (Gmail or any SMTP server) — set SMTP_USER + SMTP_PASSWORD
  2. Resend API — set RESEND_API_KEY
  3. Dev fallback — logs the subject to stdout (no credentials needed)

For Gmail: enable 2FA then generate an App Password at
https://myaccount.google.com/apppasswords — use that as SMTP_PASSWORD.
"""

import asyncio
import base64
import smtplib
from email.header import Header

import structlog

log = structlog.get_logger()


def _send_smtp_sync(
    *,
    host: str,
    port: int,
    user: str,
    password: str,
    from_addr: str,
    to: str,
    subject: str,
    html: str,
    priority: bool = False,
) -> None:
    # Build a minimal RFC 2822 message entirely as ASCII bytes.
    # The subject is RFC2047-encoded; the HTML body is base64-encoded.
    # This avoids all Windows cp1252 codec surprises inside Python's MIME stack.
    subject_hdr = Header(subject, "utf-8").encode()
    html_b64 = base64.b64encode(html.encode("utf-8")).decode("ascii")
    # X-Priority/X-MSMail-Priority/Importance is the standard trio recognized
    # across Outlook/Gmail/Apple Mail for a "high priority" flag on the
    # message -- no single header is honored by every client, so all three.
    priority_hdrs = (
        "X-Priority: 1\r\nX-MSMail-Priority: High\r\nImportance: High\r\n" if priority else ""
    )
    raw = (
        f"From: {from_addr}\r\n"
        f"To: {to}\r\n"
        f"Subject: {subject_hdr}\r\n"
        f"{priority_hdrs}"
        f"MIME-Version: 1.0\r\n"
        f"Content-Type: text/html; charset=utf-8\r\n"
        f"Content-Transfer-Encoding: base64\r\n"
        f"\r\n"
        f"{html_b64}\r\n"
    ).encode("ascii")
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(user, password)
        smtp.sendmail(from_addr, to, raw)


async def send_email(*, to: str, subject: str, html: str, priority: bool = False) -> None:
    from app.core.config import settings

    # ── 1. SMTP ──────────────────────────────────────────────────────────────
    if settings.SMTP_USER and settings.SMTP_PASSWORD:
        from_addr = settings.SMTP_FROM or settings.SMTP_USER
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: _send_smtp_sync(
                    host=settings.SMTP_HOST,
                    port=settings.SMTP_PORT,
                    user=settings.SMTP_USER,  # type: ignore[arg-type]
                    password=settings.SMTP_PASSWORD,  # type: ignore[arg-type]
                    from_addr=from_addr,
                    to=to,
                    subject=subject,
                    html=html,
                    priority=priority,
                ),
            )
            safe = subject.encode("ascii", errors="replace").decode("ascii")
            log.info("email.sent.smtp", to=to, subject=safe)
            return
        except Exception as exc:
            log.warning("email.smtp.failed", error=str(exc), fallback="resend")

    # ── 2. Resend API ─────────────────────────────────────────────────────────
    if settings.RESEND_API_KEY:
        import httpx

        try:
            payload = {
                "from": f"Manju Trade AI Pro <{settings.RESEND_FROM}>",
                "to": [to],
                "subject": subject,
                "html": html,
            }
            if priority:
                # Resend passes custom headers through as-is to the outgoing
                # message -- same trio as the SMTP path above.
                payload["headers"] = {
                    "X-Priority": "1",
                    "X-MSMail-Priority": "High",
                    "Importance": "High",
                }
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                if resp.status_code < 400:
                    log.info("email.sent.resend", to=to, subject=subject)
                    return
                log.warning("email.resend.failed", status=resp.status_code, body=resp.text)
        except Exception as exc:
            log.warning("email.resend.error", error=str(exc))

    # ── 3. Dev fallback ───────────────────────────────────────────────────────
    # ASCII-encode subject so structlog doesn't crash on Windows cp1252 terminals
    safe_subject = subject.encode("ascii", errors="replace").decode("ascii")
    log.info(
        "email.dev_log",
        to=to,
        subject=safe_subject,
        hint="Set SMTP_USER+SMTP_PASSWORD or RESEND_API_KEY to actually send",
    )
