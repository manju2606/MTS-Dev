"""Add volume and market_cap columns to chartink_breakout_alerts.

Breakout alerts now carry raw latest-session share volume (free -- already
computed by fetch_technicals()'s batch download) and market cap (one
fast_info call per breakout symbol, bounded since this only runs for
symbols that just crossed the streak threshold) so the Breakout Watchlist's
quality gate filters can screen on liquidity/size, not just AI score/R:R/
ADX/RSI -- see chartink_signal_service._record_and_alert_breakouts().

Revision ID: 0009_chartink_breakout_volume_market_cap
Revises: 0008_chartink_breakout_scoring
Create Date: 2026-08-14
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0009_breakout_vol_mcap"
down_revision = "0008_chartink_breakout_scoring"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chartink_breakout_alerts", sa.Column("volume", sa.Float(), nullable=True))
    op.add_column("chartink_breakout_alerts", sa.Column("market_cap", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("chartink_breakout_alerts", "market_cap")
    op.drop_column("chartink_breakout_alerts", "volume")
