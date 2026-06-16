"""add user_threshold to clients

Revision ID: 005_add_user_threshold
Revises: 004_add_client_logo
Create Date: 2026-06-16

"""
from alembic import op
import sqlalchemy as sa

revision = "005_add_user_threshold"
down_revision = "004_add_client_logo"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("clients", sa.Column("user_threshold", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("clients", "user_threshold")
