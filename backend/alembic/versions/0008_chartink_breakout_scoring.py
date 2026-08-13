"""Add AI-scoring and resolution columns to chartink_breakout_alerts.

Breakout alerts now get scored once at breakout time with the same AI
engine regular Chartink candidates use (confidence/entry/stop_loss/
target/rsi/adx/volume_ratio/explanation), and resolved WIN/LOSS/EXPIRED
against that entry/stop_loss/target the same way MCX signals are -- see
chartink_signal_service.py.

Revision ID: 0008_chartink_breakout_scoring
Revises: 0007_chartink_poll_runs
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0008_chartink_breakout_scoring"
down_revision = "0007_chartink_poll_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chartink_breakout_alerts", sa.Column("confidence", sa.Float(), nullable=True))
    op.add_column("chartink_breakout_alerts", sa.Column("entry_price", sa.Float(), nullable=True))
    op.add_column("chartink_breakout_alerts", sa.Column("stop_loss", sa.Float(), nullable=True))
    op.add_column("chartink_breakout_alerts", sa.Column("target", sa.Float(), nullable=True))
    op.add_column(
        "chartink_breakout_alerts", sa.Column("risk_reward_ratio", sa.Float(), nullable=True)
    )
    op.add_column("chartink_breakout_alerts", sa.Column("rsi", sa.Float(), nullable=True))
    op.add_column("chartink_breakout_alerts", sa.Column("adx", sa.Float(), nullable=True))
    op.add_column("chartink_breakout_alerts", sa.Column("volume_ratio", sa.Float(), nullable=True))
    op.add_column(
        "chartink_breakout_alerts", sa.Column("explanation", sa.Text(), nullable=True)
    )
    op.add_column(
        "chartink_breakout_alerts",
        sa.Column("status", sa.String(length=10), nullable=False, server_default="OPEN"),
    )
    op.add_column("chartink_breakout_alerts", sa.Column("exit_price", sa.Float(), nullable=True))
    op.add_column("chartink_breakout_alerts", sa.Column("closed_at", sa.DateTime(), nullable=True))
    op.create_index(
        "ix_chartink_breakout_alerts_status", "chartink_breakout_alerts", ["status"]
    )


def downgrade() -> None:
    op.drop_index("ix_chartink_breakout_alerts_status", table_name="chartink_breakout_alerts")
    op.drop_column("chartink_breakout_alerts", "closed_at")
    op.drop_column("chartink_breakout_alerts", "exit_price")
    op.drop_column("chartink_breakout_alerts", "status")
    op.drop_column("chartink_breakout_alerts", "explanation")
    op.drop_column("chartink_breakout_alerts", "volume_ratio")
    op.drop_column("chartink_breakout_alerts", "adx")
    op.drop_column("chartink_breakout_alerts", "rsi")
    op.drop_column("chartink_breakout_alerts", "risk_reward_ratio")
    op.drop_column("chartink_breakout_alerts", "target")
    op.drop_column("chartink_breakout_alerts", "stop_loss")
    op.drop_column("chartink_breakout_alerts", "entry_price")
    op.drop_column("chartink_breakout_alerts", "confidence")
