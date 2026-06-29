import hashlib
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decode_token
from app.domain.interfaces.market_data import MarketDataClient
from app.domain.interfaces.repositories import (
    AISignalRepository,
    TradeRepository,
    WatchlistRepository,
)
from app.domain.models.risk import RiskConfig
from app.domain.models.user import SubscriptionTier, User, UserRole
from app.domain.services.risk_engine import RiskEngine
from app.infra.ai.claude_client import ClaudeAIClient
from app.infra.ai.local_engine import LocalAIClient
from app.infra.db.repositories.ai_signal_repo import SQLAISignalRepository
from app.infra.db.repositories.trade_repo import SQLTradeRepository
from app.infra.db.repositories.watchlist_repo import SQLWatchlistRepository
from app.infra.db.session import get_db
from app.infra.market_data.yfinance_client import YFinanceClient

_bearer = HTTPBearer(auto_error=False)
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

_TIER_DAILY_LIMITS: dict[str, int] = {
    SubscriptionTier.FREE: 10,
    SubscriptionTier.BASIC: 100,
    SubscriptionTier.PRO: 9_999,
}


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    api_key: Annotated[str | None, Depends(_api_key_header)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    from app.infra.db.repositories.api_key_repo import SQLApiKeyRepository
    from app.infra.db.repositories.user_repo import SQLUserRepository

    # --- JWT path ---
    if credentials:
        try:
            payload = decode_token(credentials.credentials)
            user_id = UUID(payload["sub"])
            repo = SQLUserRepository(db)
            user = await repo.get_by_id(user_id)
            if user and user.is_active:
                return user
        except Exception:
            pass

    # --- API key path ---
    if api_key and api_key.startswith("mts_"):
        key_hash = hashlib.sha256(api_key.encode()).hexdigest()
        key_repo = SQLApiKeyRepository(db)
        key_obj = await key_repo.get_by_hash(key_hash)
        if key_obj and not key_obj.revoked:
            import contextlib
            with contextlib.suppress(Exception):
                await key_repo.touch_last_used(key_obj.id)
            user_repo = SQLUserRepository(db)
            user = await user_repo.get_by_id(key_obj.user_id)
            if user and user.is_active:
                return user

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


def require_role(*roles: UserRole):
    async def _check(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
            )
        return user

    return _check


async def check_ai_usage(current_user: Annotated[User, Depends(get_current_user)]) -> None:
    """Increment daily AI call counter and enforce tier limits. Fails open if Redis is down."""
    try:
        import redis.asyncio as aioredis

        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        key = f"usage:{current_user.id}:{date.today().isoformat()}"
        count = int(await r.incr(key) or 0)
        if count == 1:
            await r.expire(key, 172_800)  # 48 h TTL so key outlives the calendar day
        await r.aclose()
        limit = _TIER_DAILY_LIMITS.get(str(current_user.subscription_tier), 10)
        if count > limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Daily AI call limit of {limit} reached. Upgrade your subscription.",
            )
    except HTTPException:
        raise
    except Exception:
        pass  # Redis unavailable — fail open


def get_market_data_client() -> MarketDataClient:
    return YFinanceClient()


def get_watchlist_repo(db: Annotated[AsyncSession, Depends(get_db)]) -> WatchlistRepository:
    return SQLWatchlistRepository(db)


def get_trade_repo(db: Annotated[AsyncSession, Depends(get_db)]) -> TradeRepository:
    return SQLTradeRepository(db)


def get_ai_signal_repo(db: Annotated[AsyncSession, Depends(get_db)]) -> AISignalRepository:
    return SQLAISignalRepository(db)


# Per-user risk config store (in-memory; survives the process lifetime)
_user_risk_configs: dict[str, RiskConfig] = {}


def set_user_risk_config(user_id: str, config: RiskConfig) -> None:
    _user_risk_configs[user_id] = config


async def get_risk_engine(
    current_user: Annotated[User, Depends(get_current_user)],
) -> RiskEngine:
    default = RiskConfig(capital=settings.PAPER_CAPITAL)
    config = _user_risk_configs.get(str(current_user.id), default)
    return RiskEngine(config)


def get_ai_client() -> ClaudeAIClient | LocalAIClient:
    if settings.ANTHROPIC_API_KEY:
        return ClaudeAIClient(settings.ANTHROPIC_API_KEY)
    return LocalAIClient()


CurrentUser = Annotated[User, Depends(get_current_user)]
AISignalDep = Annotated[AISignalRepository, Depends(get_ai_signal_repo)]
DBSession = Annotated[AsyncSession, Depends(get_db)]
MarketDataDep = Annotated[MarketDataClient, Depends(get_market_data_client)]
WatchlistDep = Annotated[WatchlistRepository, Depends(get_watchlist_repo)]
TradeDep = Annotated[TradeRepository, Depends(get_trade_repo)]
RiskDep = Annotated[RiskEngine, Depends(get_risk_engine)]
AIDep = Annotated[ClaudeAIClient | LocalAIClient, Depends(get_ai_client)]
