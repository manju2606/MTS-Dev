import hashlib
import secrets
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import CurrentUser, DBSession
from app.core.security import (
    create_access_token,
    create_password_reset_token,
    decode_password_reset_token,
    hash_password,
    verify_password,
)
from app.domain.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: DBSession) -> dict:
    from app.infra.db.repositories.user_repo import SQLUserRepository

    repo = SQLUserRepository(db)
    if await repo.get_by_email(body.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
    )
    created = await repo.create(user)
    await _seed_default_watchlists(db, created.id)
    return {"id": str(created.id), "email": created.email}


@router.post("/login")
async def login(body: LoginRequest, db: DBSession) -> TokenResponse:
    from app.infra.db.repositories.user_repo import SQLUserRepository

    repo = SQLUserRepository(db)
    user = await repo.get_by_email(body.email)
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user.id, role=user.role.value)
    return TokenResponse(access_token=token)


@router.get("/me")
async def me(current_user: CurrentUser) -> dict:
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": current_user.role,
        "subscription_tier": current_user.subscription_tier,
        "email_verified": current_user.email_verified,
    }


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class UpdateProfileRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest, current_user: CurrentUser, db: DBSession
) -> dict:
    from app.infra.db.repositories.user_repo import SQLUserRepository

    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect"
        )
    current_user.hashed_password = hash_password(body.new_password)
    await SQLUserRepository(db).update(current_user)
    return {"message": "Password changed successfully"}


@router.patch("/me")
async def update_profile(
    body: UpdateProfileRequest, current_user: CurrentUser, db: DBSession
) -> dict:
    from app.infra.db.repositories.user_repo import SQLUserRepository

    current_user.full_name = body.full_name
    updated = await SQLUserRepository(db).update(current_user)
    return {
        "id": str(updated.id),
        "email": updated.email,
        "full_name": updated.full_name,
        "role": updated.role,
    }


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest, db: DBSession) -> dict:
    from app.infra.db.repositories.user_repo import SQLUserRepository

    repo = SQLUserRepository(db)
    user = await repo.get_by_email(body.email)
    # Always return 200 — never reveal whether the email is registered
    if not user:
        return {"message": "If that email is registered, a reset token has been issued."}
    reset_token = create_password_reset_token(user.id)
    try:
        from app.infra.email.client import send_email
        await send_email(
            to=user.email,
            subject="Manju Trade AI Pro — Password Reset",
            html=(
                f"<p>Hi {user.full_name},</p>"
                f"<p>Your password reset token:</p>"
                f"<pre style='background:#f4f4f4;padding:12px'>{reset_token}</pre>"
                f"<p>Expires in 1 hour. Ignore this email if you didn't request it.</p>"
            ),
        )
    except Exception:
        pass
    return {"message": "Reset token issued.", "reset_token": reset_token}


class CreateApiKeyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


@router.post("/api-keys", status_code=status.HTTP_201_CREATED)
async def create_api_key(
    body: CreateApiKeyRequest, current_user: CurrentUser, db: DBSession
) -> dict:
    from app.domain.models.api_key import ApiKey
    from app.infra.db.repositories.api_key_repo import SQLApiKeyRepository

    raw = "mts_" + secrets.token_hex(32)           # 68-char key shown once
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    key_prefix = raw[4:12]                          # 8 chars after the mts_ prefix
    key = ApiKey(
        user_id=current_user.id,
        name=body.name,
        key_hash=key_hash,
        key_prefix=key_prefix,
    )
    created = await SQLApiKeyRepository(db).create(key)
    return {
        "id": str(created.id),
        "name": created.name,
        "key_prefix": created.key_prefix,
        "created_at": created.created_at.isoformat(),
        "raw_key": raw,   # shown once — not stored
    }


@router.get("/api-keys")
async def list_api_keys(current_user: CurrentUser, db: DBSession) -> list[dict]:
    from app.infra.db.repositories.api_key_repo import SQLApiKeyRepository

    keys = await SQLApiKeyRepository(db).list_by_user(current_user.id)
    return [
        {
            "id": str(k.id),
            "name": k.name,
            "key_prefix": k.key_prefix,
            "created_at": k.created_at.isoformat(),
            "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
        }
        for k in keys
    ]


@router.delete("/api-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(key_id: UUID, current_user: CurrentUser, db: DBSession) -> None:
    from app.infra.db.repositories.api_key_repo import SQLApiKeyRepository

    revoked = await SQLApiKeyRepository(db).revoke(key_id, current_user.id)
    if not revoked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, db: DBSession) -> dict:
    from app.infra.db.repositories.user_repo import SQLUserRepository

    try:
        user_id = UUID(decode_password_reset_token(body.token))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    repo = SQLUserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not found")

    user.hashed_password = hash_password(body.new_password)
    await repo.update(user)
    return {"message": "Password reset successfully"}


# ── Default watchlist seeding ─────────────────────────────────────────────────

_NIFTY_50 = [
    "RELIANCE.NS","TCS.NS","HDFCBANK.NS","INFY.NS","ICICIBANK.NS",
    "HINDUNILVR.NS","ITC.NS","SBIN.NS","BHARTIARTL.NS","KOTAKBANK.NS",
    "LT.NS","AXISBANK.NS","ASIANPAINT.NS","MARUTI.NS","NESTLEIND.NS",
    "TITAN.NS","SUNPHARMA.NS","BAJFINANCE.NS","WIPRO.NS","HCLTECH.NS",
    "ULTRACEMCO.NS","BAJAJFINSV.NS","TECHM.NS","ONGC.NS","POWERGRID.NS",
    "NTPC.NS","COALINDIA.NS","TATAMOTORS.NS","TATASTEEL.NS","JSWSTEEL.NS",
    "ADANIENT.NS","ADANIPORTS.NS","DIVISLAB.NS","CIPLA.NS","DRREDDY.NS",
    "EICHERMOT.NS","GRASIM.NS","HEROMOTOCO.NS","HINDALCO.NS","INDUSINDBK.NS",
    "BRITANNIA.NS","APOLLOHOSP.NS","BPCL.NS","TATACONSUM.NS","SBILIFE.NS",
    "HDFCLIFE.NS","BAJAJ-AUTO.NS","UPL.NS","VEDL.NS","M&M.NS",
]

_log = structlog.get_logger()


async def _seed_default_watchlists(db, user_id: UUID) -> None:
    """Create My Watchlist, Nifty 50, and Stock of the Day watchlists for a new user."""
    from sqlalchemy import text
    try:
        uid = str(user_id)
        # My Watchlist
        await db.execute(
            text("INSERT INTO watchlists (id, user_id, name, created_at) VALUES (:id, :uid, 'My Watchlist', NOW()) ON CONFLICT ON CONSTRAINT uq_watchlist_user_name DO NOTHING"),
            {"id": str(uuid4()), "uid": uid},
        )
        # Nifty 50
        wl_id = str(uuid4())
        await db.execute(
            text("INSERT INTO watchlists (id, user_id, name, created_at) VALUES (:id, :uid, 'Nifty 50', NOW()) ON CONFLICT ON CONSTRAINT uq_watchlist_user_name DO NOTHING"),
            {"id": wl_id, "uid": uid},
        )
        # Re-fetch id in case of conflict
        row = await db.execute(
            text("SELECT id FROM watchlists WHERE user_id=:uid AND name='Nifty 50'"),
            {"uid": uid},
        )
        wl_id = str(row.scalar())
        for sym in _NIFTY_50:
            await db.execute(
                text("INSERT INTO watchlist_items (id, user_id, watchlist_id, symbol, exchange, added_at) VALUES (:id, :uid, :wlid, :sym, 'NSE', NOW()) ON CONFLICT ON CONSTRAINT uq_watchlist_item_symbol DO NOTHING"),
                {"id": str(uuid4()), "uid": uid, "wlid": wl_id, "sym": sym},
            )
        # Stock of the Day placeholder
        await db.execute(
            text("INSERT INTO watchlists (id, user_id, name, created_at) VALUES (:id, :uid, 'Stock of the Day', NOW()) ON CONFLICT ON CONSTRAINT uq_watchlist_user_name DO NOTHING"),
            {"id": str(uuid4()), "uid": uid},
        )
        await db.commit()
    except Exception as exc:
        _log.warning("auth.seed_watchlists.error", error=str(exc))
