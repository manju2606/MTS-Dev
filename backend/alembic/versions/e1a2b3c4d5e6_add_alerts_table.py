"""add alerts table

Revision ID: e1a2b3c4d5e6
Revises: f7a8b9c0d1e2
Create Date: 2026-06-30

"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = 'e1a2b3c4d5e6'
down_revision = 'f7a8b9c0d1e2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'alerts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('symbol', sa.String(50), nullable=False),
        sa.Column('price_target', sa.Float(), nullable=False),
        sa.Column('direction', sa.String(10), nullable=False),
        sa.Column('triggered', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('triggered_at', sa.DateTime(), nullable=True),
        sa.Column('triggered_price', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index('ix_alerts_user_id', 'alerts', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_alerts_user_id', table_name='alerts')
    op.drop_table('alerts')
