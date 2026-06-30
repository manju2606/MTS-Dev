"""Admin panel endpoints — user management, email list, and platform stats."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select

from app.api.deps import DBSession, require_role
from app.domain.models.user import UserRole
from app.infra.db.models import TradeORM, UserORM

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)


class UserPatch(BaseModel):
    role: str | None = None
    is_active: bool | None = None


class CreateUserRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: str = "viewer"


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(body: CreateUserRequest, db: DBSession) -> dict:
    from app.core.security import hash_password

    try:
        UserRole(body.role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}") from exc

    exists = (await db.execute(select(UserORM).where(UserORM.email == body.email))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail="Email already registered")

    user_orm = UserORM(
        email=body.email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
        role=body.role,
        is_active=True,
    )
    db.add(user_orm)
    await db.commit()
    await db.refresh(user_orm)
    return {
        "id": str(user_orm.id),
        "email": user_orm.email,
        "full_name": user_orm.full_name,
        "role": user_orm.role,
        "is_active": user_orm.is_active,
        "created_at": user_orm.created_at.isoformat(),
    }


@router.get("/users")
async def list_users(db: DBSession) -> list[dict]:
    result = await db.execute(select(UserORM).order_by(UserORM.created_at.desc()))
    users = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "email": u.email,
            "full_name": u.full_name,
            "role": u.role,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]


@router.patch("/users/{user_id}")
async def update_user(user_id: UUID, body: UserPatch, db: DBSession) -> dict:
    result = await db.execute(select(UserORM).where(UserORM.id == user_id))
    user_orm = result.scalar_one_or_none()
    if not user_orm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if body.role is not None:
        try:
            UserRole(body.role)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}") from exc
        user_orm.role = body.role

    if body.is_active is not None:
        user_orm.is_active = body.is_active

    await db.commit()
    await db.refresh(user_orm)
    return {
        "id": str(user_orm.id),
        "email": user_orm.email,
        "role": user_orm.role,
        "is_active": user_orm.is_active,
    }


@router.delete("/users/{user_id}")
async def deactivate_user(user_id: UUID, db: DBSession) -> dict:
    result = await db.execute(select(UserORM).where(UserORM.id == user_id))
    user_orm = result.scalar_one_or_none()
    if not user_orm:
        raise HTTPException(status_code=404, detail="User not found")
    user_orm.is_active = False
    await db.commit()
    return {"deactivated": True, "user_id": str(user_id)}


# ── Email recipient list ──────────────────────────────────────────────────────

class AddEmailRequest(BaseModel):
    email: EmailStr
    label: str = ""


@router.get("/email-list")
async def list_email_recipients() -> list[dict]:
    from app.infra.db.repositories.email_list_repo import EmailListRepository
    repo = EmailListRepository()
    return await repo.list_all()


@router.post("/email-list", status_code=status.HTTP_201_CREATED)
async def add_email_recipient(body: AddEmailRequest) -> dict:
    from app.infra.db.repositories.email_list_repo import EmailListRepository
    repo = EmailListRepository()
    existing = await repo.get_by_email(body.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already in list")
    return await repo.add(body.email, body.label)


@router.delete("/email-list/{email_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_email_recipient(email_id: str) -> None:
    from app.infra.db.repositories.email_list_repo import EmailListRepository
    repo = EmailListRepository()
    deleted = await repo.remove(email_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Email not found")


@router.patch("/email-list/{email_id}/toggle")
async def toggle_email_recipient(email_id: str) -> dict:
    from app.infra.db.repositories.email_list_repo import EmailListRepository
    repo = EmailListRepository()
    result = await repo.toggle_active(email_id)
    if not result:
        raise HTTPException(status_code=404, detail="Email not found")
    return result


@router.get("/stats")
async def platform_stats(db: DBSession) -> dict:
    total_users = (await db.execute(select(func.count()).select_from(UserORM))).scalar() or 0
    active_q = select(func.count()).select_from(UserORM).where(UserORM.is_active.is_(True))
    active_users = (await db.execute(active_q)).scalar() or 0
    total_trades = (await db.execute(select(func.count()).select_from(TradeORM))).scalar() or 0
    open_q = select(func.count()).select_from(TradeORM).where(TradeORM.status == "open")
    open_trades = (await db.execute(open_q)).scalar() or 0

    by_role_result = await db.execute(
        select(UserORM.role, func.count().label("count"))
        .group_by(UserORM.role)
    )
    by_role = {row.role: row.count for row in by_role_result}

    return {
        "total_users": total_users,
        "active_users": active_users,
        "total_trades": total_trades,
        "open_trades": open_trades,
        "users_by_role": by_role,
    }
