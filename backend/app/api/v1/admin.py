"""Admin panel endpoints — user management and platform stats."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
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
