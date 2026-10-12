"""Durable automatic job discovery progress.

Revision ID: 1c59d9862ace
Revises: 43f0951197a0
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "1c59d9862ace"
down_revision: Union[str, Sequence[str], None] = "43f0951197a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("automation_settings") as batch_op:
        batch_op.add_column(sa.Column("discovery_checked_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("discovery_cursor", sa.JSON(), server_default="{}", nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("automation_settings") as batch_op:
        batch_op.drop_column("discovery_cursor")
        batch_op.drop_column("discovery_checked_at")
