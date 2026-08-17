"""Add beta column to chartink_breakout_alerts.

Breakout alerts now carry yfinance's info["beta"] at breakout time -- one
.info call per breakout symbol, same bounded-cost pattern as market_cap's
fast_info call (see 0009_breakout_vol_mcap) -- so the Breakout Watchlist's
quality gate filters can screen on volatility/systematic risk, not just
AI score/R:R/ADX/RSI/liquidity -- see
chartink_signal_service._record_and_alert_breakouts(). Yahoo's benchmark
for this field on NSE tickers isn't documented/guaranteed to be Nifty --
see the domain model field's own comment.

Revision ID: 0010_breakout_beta
Revises: 0009_breakout_vol_mcap
Create Date: 2026-08-17
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0010_breakout_beta"
down_revision = "0009_breakout_vol_mcap"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chartink_breakout_alerts", sa.Column("beta", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("chartink_breakout_alerts", "beta")
