"""add ai_signals table

Revision ID: d4e5f6a7b8c9
Revises: b7c4e1d2f3a5
Create Date: 2026-06-28

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "d4e5f6a7b8c9"
down_revision = "b7c4e1d2f3a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_signals",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("symbol", sa.String(50), nullable=False),
        sa.Column("signal", sa.String(10), nullable=False),
        sa.Column("confidence", sa.Float, nullable=False),
        sa.Column("entry_price", sa.Float, nullable=False),
        sa.Column("stop_loss", sa.Float, nullable=False),
        sa.Column("target", sa.Float, nullable=False),
        sa.Column("risk_reward_ratio", sa.Float, nullable=False),
        sa.Column("holding_period", sa.String(50), nullable=False),
        sa.Column("explanation", sa.Text, nullable=False),
        sa.Column("engine", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("ix_ai_signals_user_id", "ai_signals", ["user_id"])
    op.create_index("ix_ai_signals_symbol", "ai_signals", ["symbol"])
    op.create_index("ix_ai_signals_created_at", "ai_signals", ["created_at"])


def downgrade() -> None:
    op.drop_table("ai_signals")
