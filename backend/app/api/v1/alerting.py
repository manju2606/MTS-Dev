"""Receives Alertmanager webhook payloads and turns each firing/resolved
alert into an in-app notification for admin users -- so infrastructure
alerts (service down, high error rate, disk/memory pressure, ...) show up
in the same bell-icon notification center as everything else, rather than
requiring a separate tool to be watched.
"""

from fastapi import APIRouter, Body, Header, HTTPException, status

router = APIRouter(prefix="/alerting", tags=["alerting"])


@router.post("/webhook")
async def alertmanager_webhook(
    body: dict = Body(...),
    authorization: str | None = Header(default=None),
) -> dict:
    import structlog
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.core.config import settings
    from app.infra.db.models import UserORM
    from app.infra.notifications.push import push

    log = structlog.get_logger()

    if settings.ALERTMANAGER_WEBHOOK_SECRET:
        expected = f"Bearer {settings.ALERTMANAGER_WEBHOOK_SECRET}"
        if authorization != expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook secret"
            )
    else:
        log.warning(
            "alerting.webhook.no_secret_configured",
            hint="Set ALERTMANAGER_WEBHOOK_SECRET to prevent unauthenticated callers "
            "from spamming admin notifications (this endpoint is proxied publicly "
            "along with the rest of /api/).",
        )

    alerts = body.get("alerts", [])
    if not alerts:
        return {"received": 0}

    engine = create_async_engine(settings.DATABASE_URL)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:
        async with Session() as session:
            result = await session.execute(select(UserORM).where(UserORM.role == "admin"))
            admin_ids = [str(row.id) for row in result.scalars()]
    finally:
        await engine.dispose()

    for alert in alerts:
        alert_status = alert.get("status", "firing")
        labels = alert.get("labels", {})
        annotations = alert.get("annotations", {})
        alertname = labels.get("alertname", "Unknown Alert")
        severity = labels.get("severity", "warning")
        summary = (
            annotations.get("summary")
            or annotations.get("description")
            or f"{alertname} is {alert_status} (severity: {severity})"
        )

        emoji = "✅" if alert_status == "resolved" else "🔴"
        title = f"{emoji} {alertname}" + (" (resolved)" if alert_status == "resolved" else "")

        for admin_id in admin_ids:
            await push(
                user_id=admin_id, type="infra.alert", title=title, body=summary, link="/admin"
            )

        log.info(
            "alerting.webhook.processed",
            alertname=alertname,
            status=alert_status,
            severity=severity,
            admins_notified=len(admin_ids),
        )

    return {"received": len(alerts)}
