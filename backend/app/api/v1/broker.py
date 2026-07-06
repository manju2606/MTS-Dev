"""Broker management endpoints — connect/disconnect Zerodha, Upstox, or use simulated."""

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
        session_store.set_broker(str(current_user.id), broker)
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
        session_store.set_broker(str(current_user.id), broker)
        return {"broker": "upstox", "connected": True}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Upstox auth failed: {exc}") from exc


# ── Simulated / Disconnect ────────────────────────────────────────────────────

@router.post("/disconnect")
async def disconnect(current_user: CurrentUser) -> dict:
    session_store.remove(str(current_user.id))
    return {"broker": "simulated", "connected": True}


@router.post("/use-simulated")
async def use_simulated(current_user: CurrentUser) -> dict:
    session_store.set_broker(str(current_user.id), SimulatedBroker())
    return {"broker": "simulated", "connected": True}


# ── Broker position import (for Portfolio Assistant) ──────────────────────────

@router.get("/positions")
async def get_broker_positions(current_user: CurrentUser) -> list[dict]:
    """Return open positions from the connected broker, formatted for Portfolio Assistant import."""
    broker = session_store.get(str(current_user.id))
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
