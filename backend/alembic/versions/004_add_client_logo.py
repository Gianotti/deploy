"""add logo columns to clients

Revision ID: 004_add_client_logo
Revises: 003_update_team_slots
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa

revision = "004_add_client_logo"
down_revision = "003_update_team_slots"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("clients", sa.Column("logo_data", sa.LargeBinary(), nullable=True))
    op.add_column("clients", sa.Column("logo_filename", sa.String(), nullable=True))


def downgrade():
    op.drop_column("clients", "logo_filename")
    op.drop_column("clients", "logo_data")
