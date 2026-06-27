from uuid import UUID

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
    return {"id": str(created.id), "email": created.email}


@router.post("/login")
async def login(body: LoginRequest, db: DBSession) -> TokenResponse:
    from app.infra.db.repositories.user_repo import SQLUserRepository

    repo = SQLUserRepository(db)
    user = await repo.get_by_email(body.email)
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@router.get("/me")
async def me(current_user: CurrentUser) -> dict:
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": current_user.role,
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
    # TODO: deliver via email. Returned in response until email service is wired up.
    return {"message": "Reset token issued.", "reset_token": reset_token}


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
