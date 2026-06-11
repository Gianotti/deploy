"""update team_notification_slots: dynamic slots, dual messages, gif

Revision ID: 003_update_team_slots
Revises: 002_add_teams
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa

revision = "003_update_team_slots"
down_revision = "002_add_teams"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("team_notification_slots", "slot_number")
    op.add_column("team_notification_slots", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("team_notification_slots", sa.Column("message_ok", sa.String(), nullable=True))
    op.add_column("team_notification_slots", sa.Column("message_blocked", sa.String(), nullable=True))
    op.add_column("team_notification_slots", sa.Column("gif_data", sa.LargeBinary(), nullable=True))
    op.add_column("team_notification_slots", sa.Column("gif_filename", sa.String(), nullable=True))
    # Migrate existing 'message' column → message_ok, then drop it
    op.execute("UPDATE team_notification_slots SET message_ok = message")
    op.drop_column("team_notification_slots", "message")


def downgrade() -> None:
    op.add_column("team_notification_slots", sa.Column("message", sa.String(), nullable=True))
    op.execute("UPDATE team_notification_slots SET message = message_ok")
    op.drop_column("team_notification_slots", "gif_filename")
    op.drop_column("team_notification_slots", "gif_data")
    op.drop_column("team_notification_slots", "message_blocked")
    op.drop_column("team_notification_slots", "message_ok")
    op.drop_column("team_notification_slots", "sort_order")
    op.add_column("team_notification_slots", sa.Column("slot_number", sa.Integer(), nullable=False, server_default="1"))
