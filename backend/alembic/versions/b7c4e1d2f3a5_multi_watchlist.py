"""multi-watchlist: add watchlists table, watchlist_id FK on items

Revision ID: b7c4e1d2f3a5
Revises: 78fd3faef12a
Create Date: 2026-06-28 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

revision: str = "b7c4e1d2f3a5"
down_revision: str | None = "78fd3faef12a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create watchlists table
    op.create_table(
        "watchlists",
        sa.Column("id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_watchlist_user_name"),
    )
    op.create_index("ix_watchlists_user_id", "watchlists", ["user_id"])

    # Add watchlist_id FK to watchlist_items (nullable for existing rows)
    op.add_column(
        "watchlist_items",
        sa.Column("watchlist_id", PGUUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_watchlist_items_watchlist",
        "watchlist_items",
        "watchlists",
        ["watchlist_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_watchlist_items_watchlist_id", "watchlist_items", ["watchlist_id"])

    # Drop old user+symbol unique constraint (same symbol can now be in multiple watchlists)
    op.drop_constraint("uq_watchlist_user_symbol", "watchlist_items", type_="unique")

    # New unique constraint: symbol unique per watchlist
    op.create_unique_constraint(
        "uq_watchlist_item_symbol", "watchlist_items", ["watchlist_id", "symbol"]
    )

    # Data migration: for each user with existing items, create a "My Watchlist"
    # and assign their orphan items to it
    op.execute("""
        INSERT INTO watchlists (id, user_id, name, created_at)
        SELECT gen_random_uuid(), DISTINCT_USERS.user_id, 'My Watchlist', NOW()
        FROM (
            SELECT DISTINCT user_id FROM watchlist_items WHERE watchlist_id IS NULL
        ) AS DISTINCT_USERS
    """)
    op.execute("""
        UPDATE watchlist_items wi
        SET watchlist_id = w.id
        FROM watchlists w
        WHERE wi.user_id = w.user_id
          AND wi.watchlist_id IS NULL
          AND w.name = 'My Watchlist'
    """)


def downgrade() -> None:
    op.drop_constraint("uq_watchlist_item_symbol", "watchlist_items", type_="unique")
    op.drop_index("ix_watchlist_items_watchlist_id", table_name="watchlist_items")
    op.drop_constraint("fk_watchlist_items_watchlist", "watchlist_items", type_="foreignkey")
    op.drop_column("watchlist_items", "watchlist_id")
    op.create_unique_constraint(
        "uq_watchlist_user_symbol", "watchlist_items", ["user_id", "symbol"]
    )
    op.drop_index("ix_watchlists_user_id", table_name="watchlists")
    op.drop_table("watchlists")
