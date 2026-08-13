"""Add chartink_poll_runs table.

Append-only log of every scan-link poll attempt (scheduled or manual
"Run Now") -- unlike chartink_scan_links.last_polled_at/last_poll_status/
last_poll_count, which only ever hold the latest run, this keeps history
over time. See app/domain/models/chartink_poll_run.py.

Revision ID: 0007_chartink_poll_runs
Revises: 0006_chartink_breakout_alerts
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0007_chartink_poll_runs"
down_revision = "0006_chartink_breakout_alerts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chartink_poll_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scan_link_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scan_name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=500), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("polled_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["scan_link_id"], ["chartink_scan_links.id"]),
    )
    op.create_index(
        "ix_chartink_poll_runs_scan_link_id", "chartink_poll_runs", ["scan_link_id"]
    )
    op.create_index(
        "ix_chartink_poll_runs_polled_at", "chartink_poll_runs", ["polled_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_chartink_poll_runs_polled_at", table_name="chartink_poll_runs")
    op.drop_index("ix_chartink_poll_runs_scan_link_id", table_name="chartink_poll_runs")
    op.drop_table("chartink_poll_runs")
