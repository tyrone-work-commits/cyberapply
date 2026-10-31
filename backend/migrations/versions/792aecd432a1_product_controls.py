"""Product controls, MFA, tasks and account settings.

Revision ID: 792aecd432a1
Revises: 1c59d9862ace
"""
import sqlalchemy as sa
from alembic import op

revision = "792aecd432a1"
down_revision = "1c59d9862ace"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("applications", sa.Column("send_after", sa.DateTime(), nullable=True))
    op.add_column("resumes", sa.Column("target_role", sa.String(300), server_default="", nullable=False))
    op.add_column("refresh_sessions", sa.Column("assurance", sa.Integer(), server_default="1", nullable=False))
    op.add_column("refresh_sessions", sa.Column("security_version", sa.Integer(), server_default="0", nullable=False))
    op.add_column("refresh_sessions", sa.Column("authenticated_at", sa.DateTime(), nullable=True))
    op.create_table("account_settings",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("theme", sa.String(20), server_default="paper", nullable=False),
        sa.Column("text_size", sa.String(20), server_default="normal", nullable=False),
        sa.Column("auto_resume", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("theme_initialized", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.create_table("mfa_factors",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("secret_encrypted", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("setup_expires_at", sa.DateTime()),
        sa.Column("last_counter", sa.Integer(), nullable=False),
        sa.Column("recovery_hashes", sa.JSON(), nullable=False),
        sa.Column("failed_checks", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime()),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False))
    op.create_table("auth_challenges",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), unique=True, nullable=False),
        sa.Column("purpose", sa.String(30), nullable=False), sa.Column("security_version", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False), sa.Column("consumed_at", sa.DateTime()),
        sa.Column("attempts", sa.Integer(), nullable=False))
    op.create_index("ix_auth_challenges_user_id", "auth_challenges", ["user_id"])
    op.create_table("application_tasks",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("application_id", sa.String(36), sa.ForeignKey("applications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False), sa.Column("title", sa.String(200), nullable=False),
        sa.Column("due_at", sa.DateTime(), nullable=False), sa.Column("remind_at", sa.DateTime(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False), sa.Column("done", sa.Boolean(), nullable=False),
        sa.Column("notified_at", sa.DateTime()))
    for name in ["user_id", "application_id", "due_at"]:
        op.create_index("ix_application_tasks_" + name, "application_tasks", [name])
    op.create_table("account_deletions",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False), sa.Column("status", sa.String(30), nullable=False),
        sa.Column("storage_keys", sa.JSON(), nullable=False), sa.Column("captured_email", sa.String(320)),
        sa.Column("error", sa.String(300)), sa.Column("requested_at", sa.DateTime(), nullable=False))


def downgrade():
    for table in ["account_deletions", "application_tasks", "auth_challenges", "mfa_factors", "account_settings"]:
        op.drop_table(table)
    with op.batch_alter_table("refresh_sessions") as batch:
        for column in ["authenticated_at", "security_version", "assurance"]:
            batch.drop_column(column)
    with op.batch_alter_table("resumes") as batch:
        batch.drop_column("target_role")
    with op.batch_alter_table("applications") as batch:
        batch.drop_column("send_after")
