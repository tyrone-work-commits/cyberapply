"""Automation controls and truthful connector capability reporting."""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import get_current_user
from app.core.time import utcnow
from app.domain.applications import automation_settings, iso, quota_usage
from app.models import User

router = APIRouter(tags=["automation"])


class AutomationPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["review", "automatic"] | None = None
    paused: bool | None = None
    daily_limit: int | None = Field(default=None, ge=1, le=100)
    min_match_score: int | None = Field(default=None, ge=0, le=100)


def settings_view(db, row):
    used = quota_usage(db, row.user_id)
    return {"mode": row.mode, "paused": row.paused, "daily_limit": row.daily_limit,
            "min_match_score": row.min_match_score, "used_today": used,
            "remaining_today": max(0, row.daily_limit - used), "quota_timezone": "UTC",
            "updated_at": iso(row.updated_at)}


@router.get("/automation")
def get_automation(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = automation_settings(db, user.id)
    db.commit()
    return settings_view(db, row)


@router.patch("/automation")
def update_automation(payload: AutomationPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = automation_settings(db, user.id, lock=True)
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(row, key, value)
    row.updated_at = utcnow()
    db.commit()
    return settings_view(db, row)


@router.get("/integrations")
def get_integrations(user: User = Depends(get_current_user)):
    from app.workers import webhook_configuration_error
    config = get_settings()
    webhook_error = webhook_configuration_error(config)
    return {"external_submissions_enabled": config.allow_external_submissions,
            "connectors": [
                {"key": "demo", "enabled": config.environment in {"local", "test"}, "is_demo": True,
                 "description": "Local employer fixture; confirmations represent simulated applications."},
                {"key": "webhook", "enabled": webhook_error is None, "is_demo": False,
                 "description": "Configured employer integration with signed requests and confirmed receipts.",
                 "unavailable_reason": webhook_error},
                {"key": "browser_form", "enabled": bool(config.allow_external_submissions and getattr(config, "browser_connector_config", {})), "is_demo": False,
                 "description": "Administrator-configured employer forms with allowlisted hosts and explicit confirmation checks."},
            ],
            "universal_ats_support": False}
