"""link integrators to the clients (stores) they work with

Revision ID: 008_add_integrator_clients
Revises: 007_add_integrators
Create Date: 2026-11-13

"""
from alembic import op
import sqlalchemy as sa

revision = "008_add_integrator_clients"
down_revision = "007_add_integrators"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "integrator_clients",
        sa.Column("integrator_id", sa.Integer(), sa.ForeignKey("integrators.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("client_id", sa.Integer(), sa.ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade():
    op.drop_table("integrator_clients")
