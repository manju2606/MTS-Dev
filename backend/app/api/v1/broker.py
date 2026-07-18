"""Broker management endpoints — connect/disconnect Zerodha, Upstox,
Alice Blue, Dhan, or use simulated."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.core.config import settings
from app.infra.brokers import session_store
from app.infra.brokers.simulated import SimulatedBroker

router = APIRouter(prefix="/broker", tags=["broker"])


@router.get("/status")
async def broker_status(current_user: CurrentUser) -> dict:
    broker = await session_store.get(str(current_user.id))
    if broker is None:
        return {"broker": "simulated", "connected": True, "note": "Using simulated broker"}
    if broker.name == "zerodha":
        # A session existing in Redis only means we once had a valid token --
        # Kite invalidates it once daily regardless of our own TTL, so confirm
        # it still actually works before reporting "connected".
        valid = await broker.validate_session()  # type: ignore[attr-defined]
        if not valid:
            return {
                "broker": "zerodha",
                "connected": False,
                "note": "Session expired — reconnect required",
            }
    return {"broker": broker.name, "connected": broker.is_connected}


# ── Zerodha ───────────────────────────────────────────────────────────────────


@router.get("/zerodha/login-url")
async def zerodha_login_url(current_user: CurrentUser) -> dict:
    if not settings.KITE_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="KITE_API_KEY not configured in .env",
        )
    try:
        from app.infra.brokers.zerodha import get_login_url

        return {"login_url": get_login_url(settings.KITE_API_KEY)}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class ZerodhaConnectRequest(BaseModel):
    request_token: str


@router.post("/zerodha/connect")
async def zerodha_connect(body: ZerodhaConnectRequest, current_user: CurrentUser) -> dict:
    if not settings.KITE_API_KEY or not settings.KITE_API_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="KITE_API_KEY / KITE_API_SECRET not configured",
        )
    try:
        from app.infra.brokers.zerodha import connect

        broker = connect(settings.KITE_API_KEY, settings.KITE_API_SECRET, body.request_token)
        await session_store.set_broker(str(current_user.id), broker)
        return {"broker": "zerodha", "connected": True}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Kite auth failed: {exc}") from exc


# ── Upstox ────────────────────────────────────────────────────────────────────


@router.get("/upstox/login-url")
async def upstox_login_url(current_user: CurrentUser) -> dict:
    if not settings.UPSTOX_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="UPSTOX_API_KEY not configured in .env",
        )
    from app.infra.brokers.upstox import get_login_url

    url = get_login_url(settings.UPSTOX_API_KEY, settings.UPSTOX_REDIRECT_URI)
    return {"login_url": url, "redirect_uri": settings.UPSTOX_REDIRECT_URI}


class UpstoxConnectRequest(BaseModel):
    code: str


@router.post("/upstox/connect")
async def upstox_connect(body: UpstoxConnectRequest, current_user: CurrentUser) -> dict:
    if not settings.UPSTOX_API_KEY or not settings.UPSTOX_API_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="UPSTOX_API_KEY / UPSTOX_API_SECRET not configured",
        )
    try:
        from app.infra.brokers.upstox import UpstoxBroker, exchange_code

        access_token = await exchange_code(
            settings.UPSTOX_API_KEY,
            settings.UPSTOX_API_SECRET,
            body.code,
            settings.UPSTOX_REDIRECT_URI,
        )
        broker = UpstoxBroker(settings.UPSTOX_API_KEY, access_token)
        await session_store.set_broker(str(current_user.id), broker)
        return {"broker": "upstox", "connected": True}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Upstox auth failed: {exc}") from exc


# ── Alice Blue (ANT) ─────────────────────────────────────────────────────────


@router.get("/aliceblue/login-url")
async def aliceblue_login_url(current_user: CurrentUser) -> dict:
    if not settings.ALICEBLUE_APP_CODE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ALICEBLUE_APP_CODE not configured in .env",
        )
    from app.infra.brokers.aliceblue import get_login_url

    return {"login_url": get_login_url(settings.ALICEBLUE_APP_CODE)}


class AliceBlueConnectRequest(BaseModel):
    user_id: str
    auth_code: str


@router.post("/aliceblue/connect")
async def aliceblue_connect(body: AliceBlueConnectRequest, current_user: CurrentUser) -> dict:
    if not settings.ALICEBLUE_API_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ALICEBLUE_API_SECRET not configured",
        )
    try:
        from app.infra.brokers.aliceblue import AliceBlueBroker, generate_session

        user_session = await generate_session(
            settings.ALICEBLUE_API_SECRET, body.user_id, body.auth_code
        )
        broker = AliceBlueBroker(client_id=body.user_id, user_session=user_session)
        await session_store.set_broker(str(current_user.id), broker)
        return {"broker": "aliceblue", "connected": True}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Alice Blue auth failed: {exc}") from exc


# ── Dhan ─────────────────────────────────────────────────────────────────────


class DhanConnectRequest(BaseModel):
    client_id: str
    access_token: str


@router.post("/dhan/connect")
async def dhan_connect(body: DhanConnectRequest, current_user: CurrentUser) -> dict:
    from app.infra.brokers.dhan import DhanBroker, validate_credentials

    if not await validate_credentials(body.client_id, body.access_token):
        raise HTTPException(
            status_code=400,
            detail="Dhan auth failed: invalid client ID or access token",
        )
    broker = DhanBroker(client_id=body.client_id, access_token=body.access_token)
    await session_store.set_broker(str(current_user.id), broker)
    return {"broker": "dhan", "connected": True}


# ── Simulated / Disconnect ────────────────────────────────────────────────────


@router.post("/disconnect")
async def disconnect(current_user: CurrentUser) -> dict:
    await session_store.remove(str(current_user.id))
    return {"broker": "simulated", "connected": True}


@router.post("/use-simulated")
async def use_simulated(current_user: CurrentUser) -> dict:
    await session_store.set_broker(str(current_user.id), SimulatedBroker())
    return {"broker": "simulated", "connected": True}


# ── Broker position import (for Portfolio Assistant) ──────────────────────────


@router.get("/positions")
async def get_broker_positions(current_user: CurrentUser) -> list[dict]:
    """Return open positions from the connected broker, formatted for Portfolio Assistant import."""
    broker = await session_store.get(str(current_user.id))
    if broker is None:
        broker = SimulatedBroker()
    positions = await broker.get_positions()
    return [
        {
            "symbol": p.get("symbol", ""),
            "qty": p.get("quantity", 0),
            "avg_price": round(float(p.get("avg_price", 0)), 2),
            "broker": broker.name,
            "exchange": p.get("exchange", "NSE"),
        }
        for p in positions
        if p.get("quantity", 0) > 0
    ]
