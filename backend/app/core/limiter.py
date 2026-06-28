from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.security import decode_token


def _rate_limit_key(request: Request) -> str:
    """JWT user ID when available, otherwise client IP."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            payload = decode_token(auth.removeprefix("Bearer "))
            return f"user:{payload['sub']}"
        except Exception:
            pass
    return get_remote_address(request)


limiter = Limiter(key_func=_rate_limit_key)
