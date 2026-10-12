"""Job capabilities, reviewed résumé recommendations and application schedules."""
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import Field, field_validator, model_validator
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import fail
from app.core.security import get_current_user, lock_active_user
from app.core.time import utcnow
from app.domain.applications import iso, owned_application
from app.domain.documents import _ensure_resume_quota, owned_resume, resume_response
from app.domain.jobs import owned_job
from app.domain.matching import compute_match, normalize
from app.domain.profiles import StrictModel
from app.models import AccountSettings, ApplicationTask, Notification, Preferences, Resume, User

router = APIRouter(tags=["Product experience"])


def submission_capability(job) -> dict:
    from app.workers import ConfirmedFailure, webhook_configuration_error
    config = get_settings()
    if job.is_demo:
        available = job.connector_key == "demo" and config.environment in {"local", "test"}
        return {"kind": "demo", "automatic": available, "label": "Demo simulation", "reason": "No employer is contacted", "url": None}
    reason = "No supported employer connection"
    if job.connector_key == "webhook":
        code = webhook_configuration_error(config)
        if code is None:
            return {"kind": "automatic", "automatic": True, "label": "Auto-apply available", "reason": "Signed employer connection configured", "url": job.apply_url or job.source_url or None}
        reason = "Employer connection is not enabled" if code == "external_submissions_disabled" else "Employer connection needs configuration"
    elif job.connector_key == "browser_form":
        from app.services.browser_apply import BrowserFormConnector
        try:
            BrowserFormConnector(config)._form(job)
            return {"kind": "automatic", "automatic": True, "label": "Auto-apply available", "reason": "Supported employer form configured", "url": job.apply_url or None}
        except ConfirmedFailure:
            reason = "This employer form is not configured or enabled"
    return {"kind": "manual", "automatic": False, "label": "Apply on employer website", "reason": reason,
            "url": job.apply_url or job.source_url or None}


class SettingsPatch(StrictModel):
    theme: Literal["paper", "midnight", "ocean", "forest", "ember", "system"] | None = None
    text_size: Literal["normal", "large"] | None = None
    auto_resume: bool | None = None


def settings_record(db, user_id):
    row = db.get(AccountSettings, user_id)
    if row is None:
        lock_active_user(db, db.get(User, user_id))
        row = AccountSettings(user_id=user_id)
        db.add(row)
        db.flush()
    return row


def settings_view(row):
    return {"theme": row.theme, "text_size": row.text_size, "auto_resume": row.auto_resume, "initialized": row.theme_initialized, "updated_at": iso(row.updated_at)}


@router.get("/account/settings")
def get_settings_route(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = settings_record(db, user.id)
    db.commit()
    return settings_view(row)


@router.patch("/account/settings")
def update_settings(payload: SettingsPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = settings_record(db, user.id)
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(row, key, value)
    if payload.theme is not None or payload.text_size is not None:
        row.theme_initialized = True
    db.commit()
    return settings_view(row)


@router.get("/jobs/{job_id}/resume-recommendations")
def recommend_resumes(job_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    job = owned_job(db, str(job_id), user.id)
    return ranked_resumes(db, user.id, job)


def ranked_resumes(db, user_id, job):
    prefs = db.get(Preferences, user_id)
    items = []
    for resume in db.scalars(select(Resume).where(Resume.user_id == user_id, Resume.reviewed.is_(True))):
        match = compute_match(job, resume.profile_data, prefs.data if prefs else {})
        role_match = normalize(job.title) == normalize(resume.target_role) or normalize(job.title) in normalize(resume.title)
        items.append({"id": resume.id, "title": resume.title, "version": resume.version, "is_main": resume.is_main,
                      "score": match["score"], "eligible": match["eligible"], "target_role": resume.target_role,
                      "matched_skills": match["matched_skills"], "missing_skills": match["missing_skills"],
                      "reasons": match["reasons"], "role_match": role_match})
    items.sort(key=lambda item: (item["eligible"], item["score"], item["role_match"], item["is_main"], item["id"]), reverse=True)
    return {"items": items, "recommended_id": items[0]["id"] if items else None,
            "basis": "Reviewed résumé facts and saved job preferences; a fit estimate, not a hiring probability"}


class TailorInput(StrictModel):
    job_id: UUID
    version: int = Field(ge=1)


def tailoring(db, user, resume_id, payload):
    resume = owned_resume(db, str(resume_id), user.id)
    job = owned_job(db, str(payload.job_id), user.id)
    if not resume.reviewed or resume.version != payload.version:
        fail(409, "resume_review_required", "Use the current reviewed résumé to suggest a targeted version")
    confirmed = resume.profile_data.get("skills", [])
    relevant = [skill for skill in confirmed if normalize(skill) in {normalize(item) for item in job.required_skills}]
    added = ["Target role: " + job.title]
    if relevant:
        added.append("Relevant confirmed skills: " + ", ".join(relevant))
    text = "\n".join(added) + "\n\n" + resume.extracted_text
    if len(text) > 200000:
        fail(422, "resume_too_long", "Shorten the source résumé before making a targeted version")
    return resume, job, text, added


@router.post("/resumes/{resume_id}/tailoring-preview")
def tailoring_preview(resume_id: UUID, payload: TailorInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    resume, job, text, added = tailoring(db, user, resume_id, payload)
    return {"source_id": resume.id, "source_version": resume.version, "original_text": resume.extracted_text,
            "suggested_text": text, "added_lines": added, "target_role": job.title,
            "note": "Only reviewed skills are highlighted. Existing experience is preserved. Review the new draft before applying."}


@router.post("/resumes/{resume_id}/tailor", status_code=201)
def create_targeted_resume(resume_id: UUID, payload: TailorInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    resume, job, text, _ = tailoring(db, user, resume_id, payload)
    _ensure_resume_quota(db, user.id)
    draft = Resume(user_id=user.id, title=(job.title + " — " + resume.title)[:255], extracted_text=text,
                   target_role=job.title, profile_data=dict(resume.profile_data), reviewed=False, is_main=False)
    db.add(draft)
    db.commit()
    return resume_response(draft)


class TaskInput(StrictModel):
    application_id: UUID
    kind: Literal["interview", "follow_up"]
    title: str = Field(min_length=1, max_length=200)
    due_at: datetime
    remind_at: datetime | None = None
    notes: str = Field(default="", max_length=2000)

    @field_validator("due_at", "remind_at")
    @classmethod
    def utc_dates(cls, value):
        if value is None:
            return value
        if value.tzinfo is None:
            raise ValueError("Include a timezone offset")
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    @model_validator(mode="after")
    def valid_dates(self):
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("A title is required")
        if self.remind_at is None:
            self.remind_at = self.due_at - timedelta(minutes=30) if self.kind == "interview" else self.due_at
        if self.remind_at > self.due_at:
            raise ValueError("The reminder must be at or before the scheduled time")
        return self


class TaskPatch(StrictModel):
    done: bool


def task_view(row):
    return {"id": row.id, "application_id": row.application_id, "kind": row.kind, "title": row.title,
            "due_at": iso(row.due_at), "remind_at": iso(row.remind_at), "notes": row.notes, "done": row.done,
            "notified_at": iso(row.notified_at)}


@router.get("/application-tasks")
def list_tasks(done: bool | None = None, limit: int = Query(default=100, ge=1, le=200),
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = select(ApplicationTask).where(ApplicationTask.user_id == user.id)
    if done is not None:
        statement = statement.where(ApplicationTask.done == done)
    rows = db.scalars(statement.order_by(ApplicationTask.due_at, ApplicationTask.id).limit(limit)).all()
    return {"items": [task_view(row) for row in rows]}


@router.post("/application-tasks", status_code=201)
def create_task(payload: TaskInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    owned_application(db, str(payload.application_id), user.id)
    row = ApplicationTask(user_id=user.id, **payload.model_dump(exclude={"application_id"}), application_id=str(payload.application_id))
    db.add(row)
    db.commit()
    return task_view(row)


def own_task(db, task_id, user):
    row = db.scalar(select(ApplicationTask).where(ApplicationTask.id == str(task_id), ApplicationTask.user_id == user.id))
    if row is None:
        fail(404, "task_not_found", "Schedule item was not found")
    return row


@router.put("/application-tasks/{task_id}")
def edit_task(task_id: UUID, payload: TaskInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = own_task(db, task_id, user)
    owned_application(db, str(payload.application_id), user.id)
    for name, value in payload.model_dump().items():
        setattr(row, name, str(value) if name == "application_id" else value)
    row.notified_at = None
    db.commit()
    return task_view(row)


@router.patch("/application-tasks/{task_id}")
def finish_task(task_id: UUID, payload: TaskPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = own_task(db, task_id, user)
    row.done = payload.done
    db.commit()
    return task_view(row)


@router.delete("/application-tasks/{task_id}")
def delete_task(task_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(own_task(db, task_id, user))
    db.commit()
    return {"deleted": True}


@router.get("/application-tasks/{task_id}/calendar")
def calendar(task_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = own_task(db, task_id, user)
    def escape(value):
        return value.replace("\\", "\\\\").replace("\r", "").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CyberApply//Application Schedule//EN", "BEGIN:VEVENT",
             "UID:" + row.id + "@cyberapply", "DTSTAMP:" + utcnow().strftime("%Y%m%dT%H%M%SZ"),
             "DTSTART:" + row.due_at.strftime("%Y%m%dT%H%M%SZ"),
             "DTEND:" + (row.due_at + timedelta(minutes=60 if row.kind == "interview" else 15)).strftime("%Y%m%dT%H%M%SZ"),
             "SUMMARY:" + escape(row.title), "DESCRIPTION:" + escape(row.notes),
             "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + escape(row.title),
             "TRIGGER;VALUE=DATE-TIME:" + row.remind_at.strftime("%Y%m%dT%H%M%SZ"),
             "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""]
    # RFC5545 fold long content lines on UTF-8 byte boundaries.
    folded = []
    for line in lines:
        chunk = ""
        for character in line:
            if len((chunk + character).encode()) > 73:
                folded.append(chunk)
                chunk = " "
            chunk += character
        folded.append(chunk)
    return Response("\r\n".join(folded), media_type="text/calendar", headers={"Content-Disposition": 'attachment; filename="cyberapply-event.ics"'})


def deliver_task_reminders(session_factory):
    now = utcnow()
    with session_factory() as db:
        rows = db.scalars(select(ApplicationTask).join(User).where(User.active.is_(True),
            ApplicationTask.done.is_(False), ApplicationTask.notified_at.is_(None), ApplicationTask.remind_at <= now).limit(100)).all()
        for row in rows:
            claimed = db.execute(update(ApplicationTask).where(ApplicationTask.id == row.id,
                ApplicationTask.notified_at.is_(None), ApplicationTask.done.is_(False)).values(notified_at=now))
            if claimed.rowcount:
                db.add(Notification(user_id=row.user_id, application_id=row.application_id, kind=row.kind,
                    title=row.title, body=("Interview" if row.kind == "interview" else "Follow-up") + " scheduled for " + iso(row.due_at)))
        db.commit()
