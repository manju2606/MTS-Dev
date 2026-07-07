"""One-off script to seed an admin user. Run from backend/:
python -m scripts.create_admin
"""

import asyncio
import sys

from app.core.security import hash_password
from app.domain.models.user import User, UserRole
from app.infra.db.models import Base
from app.infra.db.repositories.user_repo import SQLUserRepository
from app.infra.db.session import AsyncSessionLocal, engine

EMAIL = "admin@mts.dev"
PASSWORD = "Admin123!"
FULL_NAME = "MTS Admin"


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        repo = SQLUserRepository(session)
        existing = await repo.get_by_email(EMAIL)
        if existing:
            print(f"Admin already exists: {EMAIL}")
            sys.exit(0)

        user = User(
            email=EMAIL,
            hashed_password=hash_password(PASSWORD),
            full_name=FULL_NAME,
            role=UserRole.ADMIN,
        )
        created = await repo.create(user)
        print("Created admin user")
        print(f"  id:    {created.id}")
        print(f"  email: {created.email}")
        print(f"  role:  {created.role}")
        print(f"  pass:  {PASSWORD}")


asyncio.run(main())
