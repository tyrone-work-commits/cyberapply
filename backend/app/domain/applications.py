"""Owned application records and transitions; requests never submit applications."""
from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import fail
from app.core.security import get_current_user, lock_active_user
from app.core.time import utcnow
from app.domain.matching import compute_match
from app.models import (
    AccountSettings,
    Application,
    ApplicationEvent,
    AutomationSettings,
    Document,
    Job,
    Notification,
    Preferences,
    Profile,
    Resume,
    SavedJob,
    User,
)

router = APIRouter(prefix="/applications", tags=["applications"])
EDITABLE = {"needs_review", "needs_attention", "ready"}
CANCELLABLE = {"queued", "preparing", "needs_review", "needs_attention", "ready", "failed"}
STATES = {"queued", "preparing", "needs_review", "needs_attention", "ready", "submitting", "applied", "failed", "cancelled", "uncertain"}
DEFAULT_REQUIRED_FIELDS = ["full_name", "email"]
KNOWN_FIELDS = {
    "full_name", "first_name", "last_name", "email", "phone", "location", "country",
    "linkedin_url", "website", "portfolio_url", "work_authorization",
    "sponsorship_required", "salary_expectation", "available_start_date",
    "security_clearance", "resume_text", "cover_letter",
}


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ApplicationCreate(StrictInput):
    job_id: UUID
    resume_id: UUID
    mode: Literal["review", "automatic"] | None = None
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=128)
    undo_window_seconds: Literal[0, 5] = 0


class ApplicationEdit(StrictInput):
    answers: dict[str, Any] | None = None
    cover_letter: str | None = Field(default=None, max_length=20000)
    expected_version: int | None = Field(default=None, ge=1)

    @field_validator("answers")
    @classmethod
    def bounded_answers(cls, value):
        if value is None:
            return value
        if len(value) > 100 or any(not key or len(key) > 128 for key in value):
            raise ValueError("At most 100 answers with bounded field names are accepted")
        try:
            serialized = json.dumps(value, allow_nan=False)
        except (ValueError, TypeError) as exc:
            raise ValueError("Answers must contain finite JSON values") from exc
        if len(serialized) > 40000:
            raise ValueError("Answers exceed the maximum size")
        return value


class TransitionInput(StrictInput):
    expected_version: int | None = Field(default=None, ge=1)


class OutcomeUpdate(TransitionInput):
    outcome: Literal["interview", "offer", "rejected", "withdrawn"]


def iso(value: datetime | None) -> str | None:
    return value.isoformat() + "Z" if value is not None else None


def application_view(row: Application, detail: bool = True) -> dict:
    result = {
        "id": row.id, "job_id": row.job_id, "resume_id": row.resume_id,
        "mode": row.mode, "status": row.status, "version": row.version,
        "outcome": row.outcome,
        "connector_key": row.connector_key, "confirmation_id": row.confirmation_id,
        "is_demo": row.connector_key == "demo", "attempts": row.attempts,
        "missing_fields": row.missing_fields, "error_code": row.error_code,
        "error_message": row.error_message, "match": row.match_snapshot,
        "created_at": iso(row.created_at), "updated_at": iso(row.updated_at),
        "submission_started_at": iso(row.submission_started_at),
        "submitted_at": iso(row.submitted_at),
        "send_after": iso(row.send_after),
        "server_time": iso(utcnow()),
        "undo_available": bool(row.send_after and row.send_after > utcnow() and row.status == "queued" and not row.claim_token),
        "next_action": next_action(row),
    }
    if detail:
        result.update(resume_snapshot=row.resume_snapshot, answers=row.answers, cover_letter=row.cover_letter)
    return result


def next_action(row: Application) -> dict:
    if row.status == "queued" and row.send_after and row.send_after > utcnow():
        return {"label": "Undo before the countdown ends", "action": "undo"}
    if row.status == "needs_attention":
        label = "Complete: " + ", ".join(row.missing_fields) if row.missing_fields else (row.error_message or "Check the employer connection")
        return {"label": label, "action": "edit" if row.missing_fields else "connection"}
    return {"label": {"needs_review": "Review and approve your application", "uncertain": "Check the receipt before another attempt", "failed": "Review the failure before retrying", "applied": "Schedule a follow-up or interview", "cancelled": "This application was cancelled"}.get(row.status, "We are processing your application"),
            "action": {"needs_review": "review", "uncertain": "reconcile", "failed": "retry", "applied": "schedule"}.get(row.status, "wait")}


def owned_application(db: Session, application_id: str, user_id: str) -> Application:
    row = db.scalar(select(Application).where(Application.id == application_id, Application.user_id == user_id))
    if row is None:
        fail(404, "application_not_found", "Application not found")
    return row


def automation_settings(db: Session, user_id: str, lock: bool = False) -> AutomationSettings:
    row = db.get(AutomationSettings, user_id)
    if row is None:
        lock_active_user(db, db.get(User, user_id))
        row = AutomationSettings(user_id=user_id, mode="review", paused=False, daily_limit=10, min_match_score=60, updated_at=utcnow())
        db.add(row)
        db.flush()
    if lock:
        # A no-op write also serializes reservations under SQLite; PostgreSQL locks this row.
        db.execute(update(AutomationSettings).where(AutomationSettings.user_id == user_id).values(updated_at=AutomationSettings.updated_at))
        db.refresh(row)
    return row


def quota_usage(db: Session, user_id: str, now: datetime | None = None) -> int:
    now = now or utcnow()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    reservations = and_(Application.created_at >= start, Application.created_at < end, Application.status.notin_(["cancelled", "failed"]))
    attempts = and_(Application.submission_started_at >= start, Application.submission_started_at < end)
    return db.scalar(select(func.count()).select_from(Application).where(Application.user_id == user_id, or_(reservations, attempts))) or 0


def event(db: Session, row: Application, event_type: str, message: str, *, previous: str | None = None, data: dict | None = None):
    # Keep optimistic conflicts at the commit boundary, where they become HTTP 409.
    with db.no_autoflush:
        stored = db.scalar(select(func.max(ApplicationEvent.sequence)).where(ApplicationEvent.application_id == row.id)) or 0
    pending = [item.sequence for item in db.new if isinstance(item, ApplicationEvent) and item.application_id == row.id]
    sequence = max([stored, *pending]) + 1
    db.add(ApplicationEvent(id=str(uuid4()), application_id=row.id, user_id=row.user_id, event_type=event_type,
                            sequence=sequence, from_status=previous, to_status=row.status, message=message, data=data or {}, created_at=utcnow()))


def transition(db: Session, row: Application, status: str, message: str, *, event_type: str | None = None, data: dict | None = None):
    previous = row.status
    row.status = status
    row.updated_at = utcnow()
    event(db, row, event_type or status, message, previous=previous, data=data)


def commit(db: Session):
    try:
        db.commit()
    except (StaleDataError, IntegrityError):
        db.rollback()
        fail(409, "application_changed", "Application changed; refresh it before trying again")


def check_version(row: Application, expected: int | None):
    if expected is not None and row.version != expected:
        fail(409, "application_changed", "Application changed; refresh it before trying again")


def required_fields(job: Job) -> list[str]:
    requested = (job.attributes or {}).get("required_fields", DEFAULT_REQUIRED_FIELDS)
    if not isinstance(requested, list) or len(requested) > 100:
        return ["unsupported_form_schema"]
    return list(dict.fromkeys(str(name)[:128] for name in requested))


def missing_answers(job: Job, answers: dict, cover_letter: str = "") -> list[str]:
    missing = []
    for name in required_fields(job):
        value = cover_letter if name == "cover_letter" else answers.get(name)
        if value is None or value == "" or value == [] or value == {}:
            missing.append(name)
    return missing


def automatic_preference_issues(match: dict) -> list[dict]:
    return [check for check in match.get("preference_checks", []) if check.get("matches") is not True]


@router.post("", status_code=201)
def create_application(payload: ApplicationCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user),
                       idempotency_header: str | None = Header(default=None, alias="Idempotency-Key")):
    return enqueue_application(payload, db, user, idempotency_header)


def enqueue_application(payload: ApplicationCreate, db: Session, user: User,
                        idempotency_header: str | None = None, *, discovery: bool = False):
    """Reserve a durable application through the same validated path as the API."""
    lock_active_user(db, user)
    user_key = payload.idempotency_key or idempotency_header or str(uuid4())
    if not 8 <= len(user_key) <= 128:
        fail(422, "invalid_idempotency_key", "Idempotency key must contain 8 to 128 characters")
    key = hashlib.sha256(f"{user.id}:{user_key}".encode()).hexdigest()
    existing = db.scalar(select(Application).where(Application.idempotency_key == key, Application.user_id == user.id))
    if existing:
        if existing.job_id != str(payload.job_id) or existing.resume_id != str(payload.resume_id) or (payload.mode and existing.mode != payload.mode):
            fail(409, "idempotency_conflict", "This idempotency key belongs to a different application request")
        return application_view(existing)
    job = db.scalar(select(Job).where(Job.id == str(payload.job_id), or_(Job.owner_id.is_(None), Job.owner_id == user.id)))
    resume = db.scalar(select(Resume).where(Resume.id == str(payload.resume_id), Resume.user_id == user.id))
    if job is None or resume is None:
        fail(404, "resource_not_found", "Job or resume not found")
    if not job.active or (job.expires_at and job.expires_at <= utcnow()):
        fail(409, "job_unavailable", "This job is no longer available")
    profile = db.get(Profile, user.id)
    if profile is None or not profile.confirmed or not resume.reviewed:
        fail(409, "profile_review_required", "Review your profile and resume before preparing applications")
    settings = automation_settings(db, user.id, lock=True)
    if discovery:
        # Discovery is an ongoing opt-in, rechecked under the quota reservation lock.
        db.refresh(user)
        db.refresh(profile)
        db.refresh(resume)
        main = db.scalar(select(Resume.id).where(Resume.user_id == user.id, Resume.reviewed.is_(True), Resume.is_main.is_(True)))
        account = db.get(AccountSettings, user.id)
        choose_best = account is None or account.auto_resume
        if not user.active or settings.mode != "automatic" or not profile.confirmed or not resume.reviewed or not main or (not choose_best and not resume.is_main):
            fail(409, "automatic_setup_required", "Automatic discovery requires a reviewed main resume and confirmed profile")
        if choose_best:
            from app.domain.product import ranked_resumes
            if ranked_resumes(db, user.id, job)["recommended_id"] != resume.id:
                fail(409, "resume_selection_changed", "The recommended reviewed resume changed; this role will be checked again")
        passed = db.scalar(select(SavedJob.id).where(SavedJob.user_id == user.id, SavedJob.job_id == job.id, SavedJob.decision == "passed"))
        if passed:
            fail(409, "job_passed", "This job was passed by the user")
    duplicate = db.scalar(select(Application).where(Application.user_id == user.id, Application.job_id == job.id))
    undone = duplicate is not None and duplicate.status == "cancelled" and duplicate.error_code == "swipe_undone" and duplicate.attempts == 0
    if duplicate and not undone:
        if duplicate.idempotency_key == key and duplicate.resume_id == resume.id and (payload.mode is None or duplicate.mode == payload.mode):
            return application_view(duplicate)
        fail(409, "duplicate_application", "An application for this job already exists; open that record")
    if settings.paused:
        fail(409, "automation_paused", "Resume automation before adding applications to the queue")
    if quota_usage(db, user.id) >= settings.daily_limit:
        fail(429, "daily_limit_reached", "Your daily application limit has been reached")
    prefs = db.get(Preferences, user.id)
    if discovery and (prefs is None or not (prefs.data or {}).get("roles")):
        fail(409, "automatic_preferences_required", "Set preferred roles before enabling automatic discovery")
    match = compute_match(job, profile.data, prefs.data if prefs else {})
    mode = payload.mode or settings.mode
    if mode == "automatic" and (not match.get("eligible", False) or match.get("score", 0) < settings.min_match_score):
        fail(409, "automatic_match_required", "Automatic mode requires an eligible job meeting your minimum match score")
    if mode == "automatic" and any(check.get("matches") is False for check in automatic_preference_issues(match)):
        fail(409, "automatic_preferences_mismatch", "This job is outside your saved preferences; use review mode to assess it")
    if discovery and automatic_preference_issues(match):
        fail(409, "automatic_preferences_unconfirmed", "Automatic discovery requires confirmed matches for every saved preference")
    document = db.scalar(select(Document).where(Document.id == resume.document_id, Document.user_id == user.id)) if resume.document_id else None
    if resume.document_id and document is None:
        fail(409, "resume_document_unavailable", "The selected resume file is no longer available")
    snapshot = {
        "resume_id": resume.id, "version": resume.version, "title": resume.title,
        "text": resume.extracted_text, "resume_profile": copy.deepcopy(resume.profile_data),
        "profile_data": copy.deepcopy(profile.data), "captured_at": iso(utcnow()),
        "document_id": document.id if document else None, "document_sha256": document.sha256 if document else None,
    }
    if payload.undo_window_seconds and mode != "automatic":
        fail(422, "invalid_undo_mode", "The swipe countdown is available for automatic applications")
    now = utcnow()
    values = dict(user_id=user.id, job_id=job.id, resume_id=resume.id, mode=mode, status="queued",
                  resume_snapshot=snapshot, answers={}, cover_letter="", match_snapshot=copy.deepcopy(match),
                  missing_fields=[], connector_key=job.connector_key, idempotency_key=key, attempts=0,
                  error_code=None, error_message=None, claim_token=None, claim_until=None,
                  send_after=now + timedelta(seconds=payload.undo_window_seconds) if payload.undo_window_seconds else None,
                  created_at=now, updated_at=now)
    row = duplicate if undone else Application(id=str(uuid4()))
    for name, value in values.items():
        setattr(row, name, value)
    db.add(row)
    event(db, row, "queued", "Application queued for preparation", data={"mode": mode, "is_demo": job.is_demo,
          "source": "automatic_discovery" if discovery else "user", "undo_window_seconds": payload.undo_window_seconds})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        fail(409, "duplicate_application", "An application for this job or request already exists")
    db.refresh(row)
    return application_view(row)


@router.get("")
def list_applications(status: str | None = None, outcome: Literal["interview", "offer", "rejected", "withdrawn"] | None = None,
                      limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0),
                      db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if status is not None and status not in STATES:
        fail(422, "invalid_status", "Unknown application status")
    conditions = [Application.user_id == user.id]
    if status:
        conditions.append(Application.status == status)
    if outcome:
        conditions.append(Application.outcome == outcome)
    rows = db.scalars(select(Application).where(*conditions).order_by(Application.created_at.desc(), Application.id).offset(offset).limit(limit)).all()
    total = db.scalar(select(func.count()).select_from(Application).where(*conditions)) or 0
    return {"items": [application_view(row, detail=False) for row in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/summary")
def application_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statuses = {state: 0 for state in sorted(STATES)}
    for status, count in db.execute(select(Application.status, func.count()).where(Application.user_id == user.id).group_by(Application.status)):
        statuses[status] = count
    outcomes = {outcome: 0 for outcome in ["interview", "offer", "rejected", "withdrawn"]}
    for outcome, count in db.execute(select(Application.outcome, func.count()).where(Application.user_id == user.id, Application.outcome.is_not(None)).group_by(Application.outcome)):
        outcomes[outcome] = count
    unread = db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False))) or 0
    return {"total": sum(statuses.values()), "by_status": statuses, "by_outcome": outcomes,
            "needs_review": statuses["needs_review"], "needs_attention": statuses["needs_attention"] + statuses["uncertain"],
            "active": sum(statuses[state] for state in ["queued", "preparing", "ready", "submitting"]),
            "unread_notifications": unread}


@router.get("/{application_id}")
def get_application(application_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return application_view(owned_application(db, str(application_id), user.id))


@router.post("/{application_id}/undo")
def undo_swipe(application_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned_application(db, str(application_id), user.id)
    if row.status == "cancelled" and row.error_code == "swipe_undone":
        return application_view(row)
    now = utcnow()
    result = db.execute(update(Application).where(Application.id == row.id, Application.user_id == user.id,
        Application.version == row.version, Application.status == "queued", Application.send_after > now,
        Application.attempts == 0, Application.claim_token.is_(None)).values(
        status="cancelled", error_code="swipe_undone", error_message=None, send_after=None,
        updated_at=now, version=row.version + 1).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        db.rollback()
        fail(409, "undo_expired", "The countdown ended. Check Applications for the current status.")
    db.refresh(row)
    event(db, row, "swipe_undone", "Right swipe undone before processing; no application was sent", previous="queued")
    commit(db)
    return application_view(row)


@router.get("/{application_id}/events")
def list_events(application_id: UUID, limit: int = Query(default=100, ge=1, le=100), offset: int = Query(default=0, ge=0),
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned_application(db, str(application_id), user.id)
    events = db.scalars(select(ApplicationEvent).where(ApplicationEvent.application_id == row.id, ApplicationEvent.user_id == user.id)
                       .order_by(ApplicationEvent.sequence).offset(offset).limit(limit)).all()
    return {"items": [{"id": item.id, "sequence": item.sequence, "event_type": item.event_type, "from_status": item.from_status,
                       "to_status": item.to_status, "message": item.message, "data": item.data,
                       "created_at": iso(item.created_at)} for item in events]}


@router.patch("/{application_id}")
def edit_application(application_id: UUID, payload: ApplicationEdit, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned_application(db, str(application_id), user.id)
    check_version(row, payload.expected_version)
    if row.status not in EDITABLE:
        fail(409, "application_not_editable", "This application cannot be edited in its current state")
    if row.claim_token and row.claim_until and row.claim_until > utcnow():
        fail(409, "application_busy", "The worker is processing this application; refresh shortly")
    if payload.answers is not None:
        row.answers = copy.deepcopy(payload.answers)
    if payload.cover_letter is not None:
        row.cover_letter = payload.cover_letter
    job = db.get(Job, row.job_id)
    row.missing_fields = missing_answers(job, row.answers, row.cover_letter)
    row.error_code = row.error_message = None
    status = "needs_attention" if row.missing_fields else "needs_review"
    transition(db, row, status, "Application answers updated; review before approving", event_type="edited")
    commit(db)
    return application_view(row)


@router.patch("/{application_id}/outcome")
def update_outcome(application_id: UUID, payload: OutcomeUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned_application(db, str(application_id), user.id)
    check_version(row, payload.expected_version)
    if row.status != "applied":
        fail(409, "submission_not_confirmed", "Record interview and hiring outcomes after a confirmed submission")
    previous = row.outcome
    row.outcome = payload.outcome
    row.updated_at = utcnow()
    event(db, row, "outcome_updated", "User updated the application outcome",
          data={"previous_outcome": previous, "outcome": payload.outcome, "source": "user"})
    commit(db)
    return application_view(row)


@router.post("/{application_id}/approve")
def approve_application(application_id: UUID, payload: TransitionInput | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned_application(db, str(application_id), user.id)
    check_version(row, payload.expected_version if payload else None)
    if row.status != "needs_review":
        fail(409, "review_required", "Only an application awaiting review can be approved")
    job = db.get(Job, row.job_id)
    if missing_answers(job, row.answers, row.cover_letter):
        fail(409, "missing_application_fields", "Complete the required answers before approving")
    row.error_code = row.error_message = None
    row.mode = "review"
    transition(db, row, "ready", "User approved the application for submission", event_type="approved")
    commit(db)
    return application_view(row)


@router.post("/{application_id}/cancel")
def cancel_application(application_id: UUID, payload: TransitionInput | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned_application(db, str(application_id), user.id)
    check_version(row, payload.expected_version if payload else None)
    if row.status not in CANCELLABLE:
        fail(409, "cannot_cancel", "Submission has started or the application is already complete; it cannot be cancelled")
    row.claim_token = row.claim_until = None
    transition(db, row, "cancelled", "User cancelled the queued application")
    commit(db)
    return application_view(row)


@router.post("/{application_id}/retry")
def retry_application(application_id: UUID, payload: TransitionInput | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned_application(db, str(application_id), user.id)
    check_version(row, payload.expected_version if payload else None)
    if row.status == "uncertain":
        fail(409, "reconciliation_required", "The outcome is unknown; reconcile it before retrying to avoid a duplicate submission")
    if row.status != "failed":
        fail(409, "cannot_retry", "Only a confirmed failed application can be retried")
    if row.attempts >= get_settings().max_application_attempts:
        fail(409, "attempt_limit_reached", "The retry limit for this application has been reached")
    settings = automation_settings(db, user.id, lock=True)
    if settings.paused:
        fail(409, "automation_paused", "Resume automation before retrying")
    row.claim_token = row.claim_until = None
    row.error_code = row.error_message = None
    # Preserve user edits and immutable snapshots; no preparation overwrite on retries.
    status = "ready" if row.answers and not row.missing_fields else "queued"
    transition(db, row, status, "User requested a retry of a confirmed failure", event_type="retry_requested")
    commit(db)
    return application_view(row)


@router.post("/{application_id}/reconcile")
def reconcile_application(application_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned_application(db, str(application_id), user.id)
    if row.status != "uncertain":
        fail(409, "not_uncertain", "Only an application with an unknown outcome needs reconciliation")
    if row.error_code == "reconciliation_requested":
        return application_view(row)
    row.error_code = "reconciliation_requested"
    row.updated_at = utcnow()
    event(db, row, "reconciliation_requested", "Queued a receipt lookup; this action will not resubmit the application")
    commit(db)
    return application_view(row)
