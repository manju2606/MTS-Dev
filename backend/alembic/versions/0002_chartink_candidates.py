"""Add chartink_candidates table.

Stores scored candidates received from Chartink's scan-alert webhook (see
app/api/v1/chartink.py and app/services/chartink_signal_service.py) -- one
row per (scan_name, symbol) received, with Entry/Stop-Loss/Target/Confidence
already computed by the Signal Engine at insert time.

Revision ID: 0002_chartink_candidates
Revises: 0001_zerodha_autologin
Create Date: 2026-08-12
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0002_chartink_candidates"
down_revision = "0001_zerodha_autologin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chartink_candidates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scan_name", sa.String(length=255), nullable=False),
        sa.Column("symbol", sa.String(length=50), nullable=False),
        sa.Column("trigger_price", sa.Float(), nullable=False),
        sa.Column("signal", sa.String(length=10), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("entry_price", sa.Float(), nullable=False),
        sa.Column("stop_loss", sa.Float(), nullable=False),
        sa.Column("target", sa.Float(), nullable=False),
        sa.Column("risk_reward_ratio", sa.Float(), nullable=False),
        sa.Column("holding_period", sa.String(length=50), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("rsi", sa.Float(), nullable=False),
        sa.Column("adx", sa.Float(), nullable=False),
        sa.Column("volume_ratio", sa.Float(), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_chartink_candidates_scan_name", "chartink_candidates", ["scan_name"]
    )
    op.create_index("ix_chartink_candidates_symbol", "chartink_candidates", ["symbol"])
    op.create_index(
        "ix_chartink_candidates_received_at", "chartink_candidates", ["received_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_chartink_candidates_received_at", table_name="chartink_candidates")
    op.drop_index("ix_chartink_candidates_symbol", table_name="chartink_candidates")
    op.drop_index("ix_chartink_candidates_scan_name", table_name="chartink_candidates")
    op.drop_table("chartink_candidates")
