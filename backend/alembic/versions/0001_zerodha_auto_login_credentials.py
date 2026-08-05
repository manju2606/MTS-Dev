"""Add zerodha_auto_login_credentials table.

Stores encrypted Zerodha web-login credentials (Kite user ID, password,
TOTP secret) for users who opt into unattended daily auto-login instead of
the manual reconnect flow -- see app/infra/brokers/zerodha_autologin.py and
app/core/crypto.py.

Revision ID: 0001_zerodha_autologin
Revises: e1a2b3c4d5e6
Create Date: 2026-08-05
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001_zerodha_autologin"
down_revision = "e1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "zerodha_auto_login_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("encrypted_payload", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("last_auto_login_at", sa.DateTime(), nullable=True),
        sa.Column("last_auto_login_ok", sa.Boolean(), nullable=True),
    )
    op.create_index(
        "ix_zerodha_auto_login_credentials_user_id",
        "zerodha_auto_login_credentials",
        ["user_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_zerodha_auto_login_credentials_user_id",
        table_name="zerodha_auto_login_credentials",
    )
    op.drop_table("zerodha_auto_login_credentials")
