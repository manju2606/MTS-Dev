"""Create a notification record and broadcast it to any open WebSocket connections."""

from __future__ import annotations

import asyncio
from datetime import datetime

import structlog

from app.core import connection_manager as cm
from app.domain.models.notification import Notification
from app.infra.db.repositories import notification_repo

log = structlog.get_logger()


async def push(
    user_id: str,
    type: str,
    title: str,
    body: str,
    link: str = "",
) -> Notification:
    n = Notification(
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        link=link,
        created_at=datetime.utcnow(),
    )
    await notification_repo.create(n)

    await cm.broadcast(
        user_id,
        {
            "type": "notification",
            "data": {
                "id": str(n.id),
                "type": n.type,
                "title": n.title,
                "body": n.body,
                "link": n.link,
                "read": n.read,
                "created_at": n.created_at.isoformat(),
            },
        },
    )
    return n


def fire(user_id: str, type: str, title: str, body: str, link: str = "") -> None:
    """Non-blocking helper: schedules push() as an asyncio task."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(push(user_id, type, title, body, link))
    except RuntimeError:
        log.warning("notifications.push.no_event_loop", user_id=user_id, type=type)
