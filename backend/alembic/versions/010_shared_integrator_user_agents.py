"""a User-Agent can be shared by several integrators (unique per integrator only)

Revision ID: 010_shared_integrator_user_agents
Revises: 009_add_integrator_user_agents
Create Date: 2026-11-16

"""
from alembic import op

revision = "010_shared_integrator_user_agents"
down_revision = "009_add_integrator_user_agents"
branch_labels = None
depends_on = None


def upgrade():
    # Postgres' default name for the column-level UNIQUE created in 009.
    op.execute("ALTER TABLE integrator_user_agents DROP CONSTRAINT IF EXISTS integrator_user_agents_pattern_key")
    op.create_unique_constraint("uq_integrator_user_agents_integrator_pattern", "integrator_user_agents",
                                ["integrator_id", "pattern"])


def downgrade():
    op.drop_constraint("uq_integrator_user_agents_integrator_pattern", "integrator_user_agents", type_="unique")
    op.create_unique_constraint("integrator_user_agents_pattern_key", "integrator_user_agents", ["pattern"])
