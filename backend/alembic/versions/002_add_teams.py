"""add teams

Revision ID: 002_add_teams
Revises: 001_add_repositories
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY

revision = "002_add_teams"
down_revision = "001_add_repositories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teams",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("deploy_days", ARRAY(sa.Integer()), nullable=False, server_default="{}"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index(op.f("ix_teams_id"), "teams", ["id"], unique=False)

    op.create_table(
        "team_channels",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("webhook_url", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_team_channels_id"), "team_channels", ["id"], unique=False)

    op.create_table(
        "team_notification_slots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("slot_number", sa.Integer(), nullable=False),
        sa.Column("time", sa.String(5), nullable=True),
        sa.Column("message", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_team_notification_slots_id"), "team_notification_slots", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_team_notification_slots_id"), table_name="team_notification_slots")
    op.drop_table("team_notification_slots")
    op.drop_index(op.f("ix_team_channels_id"), table_name="team_channels")
    op.drop_table("team_channels")
    op.drop_index(op.f("ix_teams_id"), table_name="teams")
    op.drop_table("teams")
