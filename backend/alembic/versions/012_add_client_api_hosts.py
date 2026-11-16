"""clients.api_hosts: extra hosts (e.g. an API on another domain) the integrator monitor looks at

Revision ID: 012_add_client_api_hosts
Revises: 011_add_integrator_consumes
Create Date: 2026-11-16

"""
from alembic import op
import sqlalchemy as sa

revision = "012_add_client_api_hosts"
down_revision = "011_add_integrator_consumes"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("clients", sa.Column("api_hosts", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("clients", "api_hosts")
