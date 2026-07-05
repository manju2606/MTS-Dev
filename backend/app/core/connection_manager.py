"""In-process WebSocket connection registry for per-user broadcasts."""
from __future__ import annotations

from collections import defaultdict

from fastapi import WebSocket

_connections: dict[str, list[WebSocket]] = defaultdict(list)


def register(user_id: str, ws: WebSocket) -> None:
    _connections[user_id].append(ws)


def deregister(user_id: str, ws: WebSocket) -> None:
    conns = _connections.get(user_id)
    if conns:
        try:
            conns.remove(ws)
        except ValueError:
            pass


async def broadcast(user_id: str, message: dict) -> None:
    for ws in list(_connections.get(user_id, [])):
        try:
            await ws.send_json(message)
        except Exception:
            pass
