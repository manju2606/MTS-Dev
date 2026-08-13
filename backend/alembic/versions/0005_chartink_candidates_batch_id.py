"""Add batch_id to chartink_candidates.

Groups every candidate saved from one process_chartink_alert() call (one
webhook delivery, or one scan-link poll) -- received_at can't be used for
this instead since each candidate gets its own via a dataclass
default_factory at object-creation time inside a loop, so two rows from
the same batch can differ by several milliseconds. Nullable since rows
saved before this migration (there are none in practice -- no real
webhook traffic had landed yet) have no batch to backfill from. Used by
chartink_repo.compare_latest_batches() (new/persistent/dropped).

Revision ID: 0005_chartink_batch_id
Revises: 0004_chartink_scan_links
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0005_chartink_batch_id"
down_revision = "0004_chartink_scan_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chartink_candidates",
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_chartink_candidates_batch_id", "chartink_candidates", ["batch_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_chartink_candidates_batch_id", table_name="chartink_candidates")
    op.drop_column("chartink_candidates", "batch_id")
