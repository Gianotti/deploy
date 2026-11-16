"""integrators.consumes: path prefixes each integrator consumes (only those count as its traffic)

Prefilled from the paths written in each integrator's notes ("Consume BNA: api/v1/products/, ...").

Revision ID: 011_add_integrator_consumes
Revises: 010_shared_integrator_uas
Create Date: 2026-11-16

"""
from alembic import op
import sqlalchemy as sa

from app.services.integrators import paths_from_text

revision = "011_add_integrator_consumes"
down_revision = "010_shared_integrator_uas"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("integrators", sa.Column("consumes", sa.Text(), nullable=True))
    conn = op.get_bind()
    for iid, notes in conn.execute(sa.text("SELECT id, notes FROM integrators WHERE notes IS NOT NULL")).fetchall():
        paths = paths_from_text(notes)
        if paths:
            conn.execute(sa.text("UPDATE integrators SET consumes = :c WHERE id = :i"), {"c": "\n".join(paths), "i": iid})


def downgrade():
    op.drop_column("integrators", "consumes")
