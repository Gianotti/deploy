"""add site_host to clients

Revision ID: 006_add_client_site_host
Revises: 005_add_user_threshold
Create Date: 2026-10-14

"""
from alembic import op
import sqlalchemy as sa

revision = "006_add_client_site_host"
down_revision = "005_add_user_threshold"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("clients", sa.Column("site_host", sa.String(), nullable=True))


def downgrade():
    op.drop_column("clients", "site_host")
