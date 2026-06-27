"""In-memory broker session store — keyed by user_id string.

Survives for the lifetime of the process. Swap for Redis in production.
"""

from app.domain.interfaces.broker import AbstractBroker

_sessions: dict[str, AbstractBroker] = {}


def get(user_id: str) -> AbstractBroker | None:
    return _sessions.get(user_id)


def set_broker(user_id: str, broker: AbstractBroker) -> None:
    _sessions[user_id] = broker


def remove(user_id: str) -> None:
    _sessions.pop(user_id, None)


def all_sessions() -> dict[str, AbstractBroker]:
    return dict(_sessions)
