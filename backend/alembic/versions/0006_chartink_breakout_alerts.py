"""Add chartink_breakout_alerts table.

Fired once a symbol has appeared in 3 consecutive scan batches for the
same scan_name (webhook or scan-link poll) -- see
chartink_repo.check_and_record_breakouts() and
app/domain/models/chartink_breakout_alert.py. Only event facts are
stored; LTP/change/day-week-month P&L are computed live on read.

Revision ID: 0006_chartink_breakout_alerts
Revises: 0005_chartink_batch_id
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0006_chartink_breakout_alerts"
down_revision = "0005_chartink_batch_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chartink_breakout_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scan_name", sa.String(length=255), nullable=False),
        sa.Column("symbol", sa.String(length=50), nullable=False),
        sa.Column("appeared_date", sa.String(length=10), nullable=False),
        sa.Column("streak_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_chartink_breakout_alerts_scan_name", "chartink_breakout_alerts", ["scan_name"]
    )
    op.create_index(
        "ix_chartink_breakout_alerts_symbol", "chartink_breakout_alerts", ["symbol"]
    )
    op.create_index(
        "ix_chartink_breakout_alerts_created_at", "chartink_breakout_alerts", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_chartink_breakout_alerts_created_at", table_name="chartink_breakout_alerts")
    op.drop_index("ix_chartink_breakout_alerts_symbol", table_name="chartink_breakout_alerts")
    op.drop_index("ix_chartink_breakout_alerts_scan_name", table_name="chartink_breakout_alerts")
    op.drop_table("chartink_breakout_alerts")
