"""Broker management endpoints — connect/disconnect Zerodha or use simulated."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.core.config import settings
from app.infra.brokers import session_store
from app.infra.brokers.simulated import SimulatedBroker

router = APIRouter(prefix="/broker", tags=["broker"])


@router.get("/status")
async def broker_status(current_user: CurrentUser) -> dict:
    broker = session_store.get(str(current_user.id))
    if broker is None:
        return {"broker": "simulated", "connected": True, "note": "Using simulated broker"}
    return {"broker": broker.name, "connected": broker.is_connected}


@router.get("/zerodha/login-url")
async def zerodha_login_url(current_user: CurrentUser) -> dict:
    if not settings.KITE_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="KITE_API_KEY not configured in .env",
        )
    try:
        from app.infra.brokers.zerodha import get_login_url

        url = get_login_url(settings.KITE_API_KEY)
        return {"login_url": url}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class ConnectRequest(BaseModel):
    request_token: str


@router.post("/zerodha/connect")
async def zerodha_connect(body: ConnectRequest, current_user: CurrentUser) -> dict:
    if not settings.KITE_API_KEY or not settings.KITE_API_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="KITE_API_KEY / KITE_API_SECRET not configured",
        )
    try:
        from app.infra.brokers.zerodha import connect

        broker = connect(settings.KITE_API_KEY, settings.KITE_API_SECRET, body.request_token)
        session_store.set_broker(str(current_user.id), broker)
        return {"broker": "zerodha", "connected": True}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Kite auth failed: {exc}"
        ) from exc


@router.post("/disconnect")
async def disconnect(current_user: CurrentUser) -> dict:
    session_store.remove(str(current_user.id))
    return {"broker": "simulated", "connected": True}


@router.post("/use-simulated")
async def use_simulated(current_user: CurrentUser) -> dict:
    session_store.set_broker(str(current_user.id), SimulatedBroker())
    return {"broker": "simulated", "connected": True}
