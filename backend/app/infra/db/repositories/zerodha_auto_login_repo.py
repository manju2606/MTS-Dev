"""Repository for encrypted Zerodha auto-login credentials.

Mirrors SQLApiKeyRepository's shape (a concrete class, not behind an ABC in
domain/interfaces/repositories.py -- same as api_key_repo.py). Unlike
ApiKeyRepository's one-way hash, credentials here must come back out in
plaintext for the scheduled auto-login job to actually use them, so this
repository owns encrypt/decrypt (app/core/crypto.py) at the boundary: the
ORM layer only ever stores/reads the encrypted blob, and callers only ever
see the decrypted domain object.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_json, encrypt_json
from app.domain.models.zerodha_credential import ZerodhaAutoLoginCredential
from app.infra.db.models import ZerodhaAutoLoginCredentialORM


def _to_domain(orm: ZerodhaAutoLoginCredentialORM) -> ZerodhaAutoLoginCredential:
    payload = decrypt_json(orm.encrypted_payload)
    return ZerodhaAutoLoginCredential(
        id=orm.id,
        user_id=orm.user_id,
        kite_user_id=payload["kite_user_id"],
        password=payload["password"],
        totp_secret=payload["totp_secret"],
        enabled=orm.enabled,
        created_at=orm.created_at,
        updated_at=orm.updated_at,
        last_auto_login_at=orm.last_auto_login_at,
        last_auto_login_ok=orm.last_auto_login_ok,
    )


class SQLZerodhaAutoLoginRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_by_user(self, user_id: UUID) -> ZerodhaAutoLoginCredential | None:
        result = await self._db.execute(
            select(ZerodhaAutoLoginCredentialORM).where(
                ZerodhaAutoLoginCredentialORM.user_id == user_id
            )
        )
        row = result.scalar_one_or_none()
        return _to_domain(row) if row else None

    async def upsert(self, cred: ZerodhaAutoLoginCredential) -> ZerodhaAutoLoginCredential:
        """Insert or replace the single credential row for cred.user_id --
        one saved account per user, resaving overwrites (e.g. after a
        password/TOTP secret reset)."""
        payload = encrypt_json(
            {
                "kite_user_id": cred.kite_user_id,
                "password": cred.password,
                "totp_secret": cred.totp_secret,
            }
        )
        existing = await self._db.execute(
            select(ZerodhaAutoLoginCredentialORM).where(
                ZerodhaAutoLoginCredentialORM.user_id == cred.user_id
            )
        )
        row = existing.scalar_one_or_none()
        now = datetime.utcnow()
        if row is None:
            row = ZerodhaAutoLoginCredentialORM(
                id=cred.id,
                user_id=cred.user_id,
                encrypted_payload=payload,
                enabled=True,
                created_at=now,
                updated_at=now,
            )
            self._db.add(row)
        else:
            row.encrypted_payload = payload
            row.enabled = True
            row.updated_at = now
        await self._db.commit()
        await self._db.refresh(row)
        return _to_domain(row)

    async def delete(self, user_id: UUID) -> bool:
        result = await self._db.execute(
            select(ZerodhaAutoLoginCredentialORM).where(
                ZerodhaAutoLoginCredentialORM.user_id == user_id
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            return False
        await self._db.delete(row)
        await self._db.commit()
        return True

    async def mark_result(self, user_id: UUID, ok: bool) -> None:
        result = await self._db.execute(
            select(ZerodhaAutoLoginCredentialORM).where(
                ZerodhaAutoLoginCredentialORM.user_id == user_id
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            return
        row.last_auto_login_at = datetime.utcnow()
        row.last_auto_login_ok = ok
        await self._db.commit()

    async def list_enabled(self) -> list[ZerodhaAutoLoginCredential]:
        """Every user with auto-login turned on -- used by the scheduled
        job to iterate all accounts needing a fresh token each morning."""
        result = await self._db.execute(
            select(ZerodhaAutoLoginCredentialORM).where(
                ZerodhaAutoLoginCredentialORM.enabled.is_(True)
            )
        )
        creds = []
        for row in result.scalars():
            try:
                creds.append(_to_domain(row))
            except Exception:
                # Skip a row that fails to decrypt (e.g. encryption key
                # rotated) rather than blow up the whole job for everyone.
                continue
        return creds
