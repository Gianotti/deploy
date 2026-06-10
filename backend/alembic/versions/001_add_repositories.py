"""add repositories

Revision ID: 001_add_repositories
Revises:
Create Date: 2026-06-10

"""
from alembic import op
import sqlalchemy as sa

revision = "001_add_repositories"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "repositories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index(op.f("ix_repositories_id"), "repositories", ["id"], unique=False)

    op.create_table(
        "client_repositories",
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("repository_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["repository_id"], ["repositories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("client_id", "repository_id"),
    )


def downgrade() -> None:
    op.drop_table("client_repositories")
    op.drop_index(op.f("ix_repositories_id"), table_name="repositories")
    op.drop_table("repositories")
