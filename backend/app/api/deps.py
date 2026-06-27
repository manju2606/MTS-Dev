from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.domain.interfaces.market_data import MarketDataClient
from app.domain.interfaces.repositories import WatchlistRepository
from app.domain.models.user import User, UserRole
from app.infra.db.repositories.watchlist_repo import SQLWatchlistRepository
from app.infra.db.session import get_db
from app.infra.market_data.yfinance_client import YFinanceClient

security = HTTPBearer()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    from app.infra.db.repositories.user_repo import SQLUserRepository

    try:
        payload = decode_token(credentials.credentials)
        user_id = UUID(payload["sub"])
    except (ValueError, KeyError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        ) from exc

    repo = SQLUserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_role(*roles: UserRole):
    async def _check(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
            )
        return user

    return _check


def get_market_data_client() -> MarketDataClient:
    return YFinanceClient()


def get_watchlist_repo(db: Annotated[AsyncSession, Depends(get_db)]) -> WatchlistRepository:
    return SQLWatchlistRepository(db)


CurrentUser = Annotated[User, Depends(get_current_user)]
DBSession = Annotated[AsyncSession, Depends(get_db)]
MarketDataDep = Annotated[MarketDataClient, Depends(get_market_data_client)]
WatchlistDep = Annotated[WatchlistRepository, Depends(get_watchlist_repo)]
