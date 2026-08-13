"""Add chartink_scoring_config table.

Single global row (id fixed to 1) holding the editable weights/thresholds
behind the Chartink Signal Engine's confidence score and ATR sizing (see
app/domain/models/chartink_scoring_config.py and
app/services/chartink_signal_service.py). No user_id: the webhook has no
per-user context, so unlike RiskConfig this can't be a per-user setting.

Revision ID: 0003_chartink_scoring_config
Revises: 0002_chartink_candidates
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0003_chartink_scoring_config"
down_revision = "0002_chartink_candidates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chartink_scoring_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rsi_healthy_min", sa.Float(), nullable=False),
        sa.Column("rsi_healthy_max", sa.Float(), nullable=False),
        sa.Column("rsi_healthy_score", sa.Float(), nullable=False),
        sa.Column("rsi_moderate_score", sa.Float(), nullable=False),
        sa.Column("rsi_extended_score", sa.Float(), nullable=False),
        sa.Column("adx_strong_threshold", sa.Float(), nullable=False),
        sa.Column("adx_strong_score", sa.Float(), nullable=False),
        sa.Column("adx_rising_threshold", sa.Float(), nullable=False),
        sa.Column("adx_rising_score", sa.Float(), nullable=False),
        sa.Column("adx_weak_score", sa.Float(), nullable=False),
        sa.Column("vol_strong_threshold", sa.Float(), nullable=False),
        sa.Column("vol_strong_score", sa.Float(), nullable=False),
        sa.Column("vol_moderate_threshold", sa.Float(), nullable=False),
        sa.Column("vol_moderate_score", sa.Float(), nullable=False),
        sa.Column("vol_mild_threshold", sa.Float(), nullable=False),
        sa.Column("vol_mild_score", sa.Float(), nullable=False),
        sa.Column("vol_weak_score", sa.Float(), nullable=False),
        sa.Column("macd_bullish_score", sa.Float(), nullable=False),
        sa.Column("trend_score", sa.Float(), nullable=False),
        sa.Column("atr_min_pct", sa.Float(), nullable=False),
        sa.Column("atr_max_pct", sa.Float(), nullable=False),
        sa.Column("atr_target_multiplier", sa.Float(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("chartink_scoring_config")
