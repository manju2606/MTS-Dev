"""Usage metering — daily AI call counts and tier limits per user."""

from datetime import date

from fastapi import APIRouter

from app.api.deps import _TIER_DAILY_LIMITS, CurrentUser
from app.core.config import settings

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/me")
async def my_usage(current_user: CurrentUser) -> dict:
    """Return today's AI call count, tier limit, and remaining budget."""
    count = 0
    try:
        import redis.asyncio as aioredis

        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        key = f"usage:{current_user.id}:{date.today().isoformat()}"
        raw = await r.get(key)
        count = int(raw) if raw else 0
        await r.aclose()
    except Exception:
        pass  # Redis down — report 0 usage

    limit = _TIER_DAILY_LIMITS.get(str(current_user.subscription_tier), 10)
    return {
        "tier": str(current_user.subscription_tier),
        "calls_today": count,
        "limit": limit,
        "remaining": max(0, limit - count),
    }
