"""integrators identified by User-Agent fragments

Revision ID: 009_add_integrator_user_agents
Revises: 008_add_integrator_clients
Create Date: 2026-11-16

"""
from alembic import op
import sqlalchemy as sa

revision = "009_add_integrator_user_agents"
down_revision = "008_add_integrator_clients"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "integrator_user_agents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("integrator_id", sa.Integer(), sa.ForeignKey("integrators.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pattern", sa.String(), nullable=False, unique=True),
        sa.Column("label", sa.String(), nullable=True),
    )
    op.create_index("ix_integrator_user_agents_id", "integrator_user_agents", ["id"])
    op.create_index("ix_integrator_user_agents_integrator_id", "integrator_user_agents", ["integrator_id"])


def downgrade():
    op.drop_table("integrator_user_agents")
