"""add integrators and their IPs

Revision ID: 007_add_integrators
Revises: 006_add_client_site_host
Create Date: 2026-11-13

"""
from alembic import op
import sqlalchemy as sa

revision = "007_add_integrators"
down_revision = "006_add_client_site_host"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "integrators",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_integrators_id", "integrators", ["id"])
    op.create_table(
        "integrator_ips",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("integrator_id", sa.Integer(), sa.ForeignKey("integrators.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ip", sa.String(), nullable=False, unique=True),
        sa.Column("label", sa.String(), nullable=True),
    )
    op.create_index("ix_integrator_ips_id", "integrator_ips", ["id"])
    op.create_index("ix_integrator_ips_integrator_id", "integrator_ips", ["integrator_id"])


def downgrade():
    op.drop_table("integrator_ips")
    op.drop_table("integrators")
