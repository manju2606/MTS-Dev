"""Broker management endpoints — connect/disconnect Zerodha, Upstox,
Alice Blue, Dhan, or use simulated."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, DBSession
from app.core.config import settings
from app.infra.brokers import session_store
from app.infra.brokers.simulated import SimulatedBroker

router = APIRouter(prefix="/broker", tags=["broker"])


@router.get("/status")
async def broker_status(current_user: CurrentUser) -> dict:
    broker = await session_store.get(str(current_user.id))
    own_session = broker is not None
    if broker is None:
        # No session of the user's own -- fall back to whichever Zerodha
        # session is already live (e.g. the admin's), so every logged-in
        # user sees "connected" without each having to run their own OAuth
        # flow just to view data. Live order placement is unaffected: it
        # always resolves the *placing* user's own session (see live.py),
        # never this fallback.
        broker = await session_store.get_market_data_broker()
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
        if not own_session:
            return {
                "broker": "zerodha",
                "connected": True,
                "note": "Using a shared Zerodha session — connect your own account to place live orders",
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


# ── Zerodha — unattended TOTP auto-login (opt-in) ───────────────────────────
#
# Replays Kite's own web login every morning via a scheduled job instead of
# requiring the manual "1. Open login  2. paste request_token" flow above.
# Requires storing the user's Zerodha password and TOTP secret, encrypted at
# rest (app/core/crypto.py) -- see app/infra/brokers/zerodha_autologin.py for
# the tradeoffs. Credentials are write-only from the API's perspective: the
# GET endpoint never echoes password/totp_secret back.


class ZerodhaAutoLoginRequest(BaseModel):
    kite_user_id: str = Field(min_length=1, description="Zerodha login ID, e.g. AB1234")
    password: str = Field(min_length=1)
    totp_secret: str = Field(min_length=1, description="Base32 TOTP secret from Kite's 2FA setup")


@router.get("/zerodha/auto-login")
async def zerodha_auto_login_status(current_user: CurrentUser, db: DBSession) -> dict:
    from app.infra.db.repositories.zerodha_auto_login_repo import SQLZerodhaAutoLoginRepository

    cred = await SQLZerodhaAutoLoginRepository(db).get_by_user(current_user.id)
    if cred is None:
        return {"configured": False, "enabled": False}
    return {
        "configured": True,
        "enabled": cred.enabled,
        "kite_user_id": cred.kite_user_id,
        "last_auto_login_at": cred.last_auto_login_at,
        "last_auto_login_ok": cred.last_auto_login_ok,
    }


@router.post("/zerodha/auto-login")
async def save_zerodha_auto_login(
    body: ZerodhaAutoLoginRequest, current_user: CurrentUser, db: DBSession
) -> dict:
    if not settings.ZERODHA_CREDS_ENCRYPTION_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ZERODHA_CREDS_ENCRYPTION_KEY not configured on the server",
        )
    from app.domain.models.zerodha_credential import ZerodhaAutoLoginCredential
    from app.infra.db.repositories.zerodha_auto_login_repo import SQLZerodhaAutoLoginRepository

    cred = ZerodhaAutoLoginCredential(
        user_id=current_user.id,
        kite_user_id=body.kite_user_id.strip(),
        password=body.password,
        totp_secret=body.totp_secret.strip().replace(" ", ""),
    )
    try:
        await SQLZerodhaAutoLoginRepository(db).upsert(cred)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not save credentials: {exc}") from exc
    return {"configured": True, "enabled": True}


@router.post("/zerodha/auto-login/test")
async def test_zerodha_auto_login(current_user: CurrentUser, db: DBSession) -> dict:
    """Runs the auto-login flow right now, so the user can confirm their
    saved credentials/TOTP secret actually work before trusting it to run
    unattended tomorrow morning."""
    if not settings.KITE_API_KEY or not settings.KITE_API_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="KITE_API_KEY / KITE_API_SECRET not configured",
        )
    from app.infra.brokers.zerodha import ZerodhaBroker
    from app.infra.brokers.zerodha_autologin import auto_login
    from app.infra.db.repositories.zerodha_auto_login_repo import SQLZerodhaAutoLoginRepository

    repo = SQLZerodhaAutoLoginRepository(db)
    cred = await repo.get_by_user(current_user.id)
    if cred is None:
        raise HTTPException(status_code=404, detail="No auto-login credentials saved")

    try:
        access_token = await auto_login(
            settings.KITE_API_KEY,
            settings.KITE_API_SECRET,
            cred.kite_user_id,
            cred.password,
            cred.totp_secret,
        )
        broker = ZerodhaBroker(api_key=settings.KITE_API_KEY, access_token=access_token)
        await session_store.set_broker(str(current_user.id), broker)
        await repo.mark_result(current_user.id, True)
        return {"connected": True}
    except Exception as exc:
        await repo.mark_result(current_user.id, False)
        raise HTTPException(status_code=400, detail=f"Auto-login failed: {exc}") from exc


@router.delete("/zerodha/auto-login")
async def delete_zerodha_auto_login(current_user: CurrentUser, db: DBSession) -> dict:
    from app.infra.db.repositories.zerodha_auto_login_repo import SQLZerodhaAutoLoginRepository

    await SQLZerodhaAutoLoginRepository(db).delete(current_user.id)
    return {"configured": False, "enabled": False}


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
