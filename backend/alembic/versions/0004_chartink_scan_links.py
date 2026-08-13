"""Add chartink_scan_links table.

The *pull* half of the Chartink integration: a screener URL to poll on a
schedule, alongside the existing webhook (the *push* half). Results from
either path land in the same chartink_candidates table -- see
app/services/chartink_poll_service.py and
app/domain/models/chartink_scan_link.py.

Revision ID: 0004_chartink_scan_links
Revises: 0003_chartink_scoring_config
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0004_chartink_scan_links"
down_revision = "0003_chartink_scoring_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chartink_scan_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scan_name", sa.String(length=255), nullable=False),
        sa.Column("url", sa.String(length=1000), nullable=False),
        sa.Column("poll_interval_minutes", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("scan_clause", sa.Text(), nullable=True),
        sa.Column("last_polled_at", sa.DateTime(), nullable=True),
        sa.Column("last_poll_status", sa.String(length=500), nullable=True),
        sa.Column("last_poll_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("chartink_scan_links")
