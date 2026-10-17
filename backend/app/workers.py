"""Durable DB-leased application worker with fixture and signed webhook connectors.

Run locally: python -m app.workers --once, or omit --once to poll continuously.
The database queue is authoritative, including when Celery is configured.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.core.config import get_settings
from app.core.db import SessionLocal, migrate_db
from app.core.operations import live_io
from app.core.security import lock_active_user
from app.core.time import utcnow
from app.domain.applications import (
    ApplicationCreate,
    automatic_preference_issues,
    automation_settings,
    enqueue_application,
    event,
    missing_answers,
    quota_usage,
    transition,
)
from app.domain.matching import compute_match, is_cybersecurity_job
from app.models import (
    AccountSettings,
    Application,
    ApplicationEvent,
    AutomationSettings,
    Job,
    Notification,
    Preferences,
    Profile,
    Resume,
    SavedJob,
    User,
)


@dataclass(frozen=True)
class SubmissionConfirmation:
    confirmation_id: str
    is_demo: bool = False


class ConfirmedFailure(Exception):
    """The connector explicitly confirms that no application was submitted."""


class UncertainSubmission(Exception):
    """Submission may have occurred: never automatically retry."""


class ApplicationAttention(ConfirmedFailure):
    """A pre-submission form or configuration issue needs user/operator action."""


def webhook_configuration_error(config) -> str | None:
    if not config.allow_external_submissions:
        return "external_submissions_disabled"
    if not config.webhook_connector_url or not config.webhook_connector_secret:
        return "webhook_not_configured"
    parsed = urlsplit(config.webhook_connector_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        return "webhook_requires_allowlisted_https"
    allowed = {str(host).lower().strip().rstrip(".") for host in config.connector_allowed_hosts}
    if parsed.hostname.lower().rstrip(".") not in allowed:
        return "webhook_host_not_allowed"
    return None


class DemoEmployerFixture:
    """Local simulated employer fixture; does not contact an external employer."""

    def submit(self, application: Application, job: Job) -> SubmissionConfirmation:
        if not job.is_demo:
            raise ConfirmedFailure("The fixture only accepts explicitly marked demo jobs")
        return SubmissionConfirmation("demo-" + application.id, is_demo=True)

    def reconcile(self, application: Application, job: Job) -> SubmissionConfirmation:
        if application.confirmation_id and application.confirmation_id.startswith("demo-"):
            return SubmissionConfirmation(application.confirmation_id, is_demo=True)
        # A lost fixture acknowledgement cannot be reconstructed by fabricating success.
        raise UncertainSubmission("The fixture has no retained confirmation for this application")


class SignedWebhookConnector:
    """Explicit employer protocol, with idempotency and authenticated receipts.

    POST operation=submit or status to the configured HTTPS endpoint. Both request
    and response bodies use X-JobApp-Signature: sha256=<HMAC>. A signed response
    must echo application_id, status=confirmed and a nonempty confirmation_id.
    A signed status=not_submitted is an explicit negative acknowledgement.
    """

    def __init__(self, config, client_factory: Callable = httpx.Client):
        reason = webhook_configuration_error(config)
        if reason:
            raise ConfirmedFailure(reason)
        self.url = config.webhook_connector_url
        self.secret = config.webhook_connector_secret.encode()
        self.client_factory = client_factory

    def _send(self, application: Application, job: Job, operation: str) -> SubmissionConfirmation:
        payload = {"operation": operation, "application_id": application.id, "idempotency_key": application.idempotency_key,
                   "job": {"id": job.id, "source_id": job.source_id, "title": job.title, "company": job.company},
                   "answers": application.answers if operation == "submit" else None,
                   "resume": application.resume_snapshot if operation == "submit" else None,
                   "cover_letter": application.cover_letter if operation == "submit" else None}
        body = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        signature = "sha256=" + hmac.new(self.secret, body, hashlib.sha256).hexdigest()
        try:
            with self.client_factory(timeout=15.0, follow_redirects=False) as client:
                response = client.post(self.url, content=body, headers={"Content-Type": "application/json",
                                      "Idempotency-Key": application.idempotency_key, "X-JobApp-Signature": signature})
        except httpx.HTTPError as exc:
            raise UncertainSubmission("Employer response was interrupted; reconcile before retrying") from exc
        expected = "sha256=" + hmac.new(self.secret, response.content, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(response.headers.get("X-JobApp-Signature", ""), expected):
            raise UncertainSubmission("Employer response did not contain a valid signed receipt")
        try:
            result = response.json()
        except (ValueError, TypeError) as exc:
            raise UncertainSubmission("Employer returned an unreadable receipt") from exc
        if not isinstance(result, dict) or result.get("application_id") != application.id:
            raise UncertainSubmission("Employer receipt did not identify this application")
        if result.get("status") == "not_submitted":
            raise ConfirmedFailure("Employer confirmed that this application was not submitted")
        receipt = result.get("confirmation_id")
        if response.is_success and result.get("status") == "confirmed" and isinstance(receipt, str) and 1 <= len(receipt) <= 200:
            return SubmissionConfirmation(receipt)
        raise UncertainSubmission("Employer did not confirm the submission outcome")

    def submit(self, application, job):
        return self._send(application, job, "submit")

    def reconcile(self, application, job):
        return self._send(application, job, "status")


def connector_for(application: Application, job: Job, config):
    if application.connector_key != job.connector_key:
        raise ConfirmedFailure("The configured job integration changed; review this application before proceeding")
    if application.connector_key == "demo" and job.is_demo and config.environment in {"local", "test"}:
        return DemoEmployerFixture()
    if application.connector_key == "webhook" and not job.is_demo:
        return SignedWebhookConnector(config)
    if application.connector_key == "browser_form" and not job.is_demo:
        from app.services.browser_apply import BrowserFormConnector
        return BrowserFormConnector(config)
    raise ConfirmedFailure("This job has no configured supported submission integration")


def discovery_connector_available(job: Job, user: User, config) -> bool:
    """Validate trusted configuration without launching browsers or making requests."""
    if not job.is_demo and not user.email_verified:
        return False
    try:
        connector = connector_for(Application(connector_key=job.connector_key), job, config)
        if job.connector_key == "browser_form":
            connector._form(job)
    except (ConfirmedFailure, TypeError, ValueError):
        return False
    return True


def discover_automatic_applications(session_factory=None, *, max_users: int = 20,
                                    max_jobs_per_user: int = 200, max_created: int = 100) -> int:
    """Bounded, resumable discovery of existing imported/shared jobs only.

    The per-user cursor advances over a bounded job window and wraps at its end.
    A durable last-checked timestamp rotates users so unmatched users cannot
    indefinitely block others. Matches within each window are score ordered.
    Queue creation uses the API's locked reservation, ownership and snapshot path.
    """
    session_factory = session_factory or SessionLocal
    if max_users <= 0 or max_jobs_per_user <= 0 or max_created <= 0:
        return 0
    # Bounds also apply to internal/Celery callers, rather than only CLI input.
    max_users = min(max_users, 100)
    max_jobs_per_user = min(max_jobs_per_user, 500)
    max_created = min(max_created, 1000)
    config = get_settings()
    with session_factory() as db:
        user_ids = db.scalars(select(AutomationSettings.user_id)
                             .join(User, User.id == AutomationSettings.user_id)
                             .where(AutomationSettings.mode == "automatic", AutomationSettings.paused.is_(False), User.active.is_(True))
                             .order_by(AutomationSettings.discovery_checked_at.asc().nullsfirst(), AutomationSettings.user_id)
                             .limit(max_users)).all()
    created = 0
    for user_id in user_ids:
        with session_factory() as db:
            user = db.get(User, user_id)
            if not user or not user.active:
                continue
            try:
                lock_active_user(db, user)
            except HTTPException:
                db.rollback()
                continue
            settings = automation_settings(db, user_id, lock=True)
            # Rotate even users whose setup/quota is incomplete; progress is durable.
            settings.discovery_checked_at = utcnow()
            user = db.get(User, user_id)
            profile = db.get(Profile, user_id)
            prefs = db.get(Preferences, user_id)
            resume = db.scalar(select(Resume).where(Resume.user_id == user_id, Resume.is_main.is_(True), Resume.reviewed.is_(True))
                               .order_by(Resume.updated_at.desc(), Resume.id).limit(1))
            if (not user or not user.active or settings.mode != "automatic" or settings.paused
                    or not profile or not profile.confirmed or not resume
                    or not prefs or not (prefs.data or {}).get("roles")
                    or quota_usage(db, user_id) >= settings.daily_limit):
                db.commit()
                continue
            now = utcnow()
            already_applied = select(Application.id).where(Application.user_id == user_id, Application.job_id == Job.id).exists()
            passed = select(SavedJob.id).where(SavedJob.user_id == user_id, SavedJob.job_id == Job.id, SavedJob.decision == "passed").exists()
            conditions = [Job.active.is_(True), or_(Job.expires_at.is_(None), Job.expires_at > now),
                          or_(Job.owner_id.is_(None), Job.owner_id == user_id), ~already_applied, ~passed]
            cursor = settings.discovery_cursor or {}
            if cursor.get("updated_at") and cursor.get("job_id"):
                try:
                    after = datetime.fromisoformat(cursor["updated_at"])
                    conditions.append(or_(Job.updated_at > after, and_(Job.updated_at == after, Job.id > cursor["job_id"])))
                except (TypeError, ValueError):
                    pass  # An invalid old cursor safely restarts; user/job uniqueness persists.
            jobs = db.scalars(select(Job).where(*conditions).order_by(Job.updated_at, Job.id).limit(max_jobs_per_user)).all()
            if jobs:
                settings.discovery_cursor = {"updated_at": jobs[-1].updated_at.isoformat(), "job_id": jobs[-1].id}
            else:
                settings.discovery_cursor = {}
            candidates = []
            account = db.get(AccountSettings, user_id)
            choose_best = account is None or account.auto_resume
            for job in jobs:
                if not is_cybersecurity_job(job.title, job.description) or not discovery_connector_available(job, user, config):
                    continue
                match = compute_match(job, profile.data, prefs.data)
                if match.get("eligible", False) and not automatic_preference_issues(match) and match.get("score", 0) >= settings.min_match_score:
                    selected_resume = resume.id
                    if choose_best:
                        from app.domain.product import ranked_resumes
                        selected_resume = ranked_resumes(db, user_id, job)["recommended_id"] or resume.id
                    candidates.append((match["score"], job.updated_at, job.id, selected_resume))
            candidates.sort(key=lambda item: (-item[0], item[1], item[2]))
            # Persist cursor progress before enqueueing; interrupted passes revisit on wrap.
            db.commit()
        for _, _, job_id, resume_id in candidates:
            if created >= max_created:
                return created
            with session_factory() as db:
                user = db.get(User, user_id)
                job = db.get(Job, job_id)
                if not user or not user.active or not job or not discovery_connector_available(job, user, config):
                    continue
                try:
                    enqueue_application(ApplicationCreate(job_id=job_id, resume_id=resume_id, mode="automatic",
                                                          idempotency_key="automatic-discovery-" + job_id),
                                        db, user, discovery=True)
                    created += 1
                except HTTPException as exc:
                    db.rollback()
                    # Concurrent pause/quota/setup changes stop this user's pass.
                    code = exc.detail.get("code") if isinstance(exc.detail, dict) else None
                    if exc.status_code == 429 or code in {"automation_paused", "automatic_setup_required", "automatic_preferences_required", "profile_review_required"}:
                        break
    return created


def notify(db: Session, row: Application, kind: str, title: str, body: str):
    db.add(Notification(id=str(uuid4()), user_id=row.user_id, application_id=row.id, kind=kind,
                        title=title, body=body, is_read=False, created_at=utcnow()))


def release(row: Application):
    row.claim_token = row.claim_until = None


def claim_next(session_factory=None) -> tuple[str, str] | None:
    """Atomic compare-and-set claim works for SQLite and PostgreSQL workers."""
    session_factory = session_factory or SessionLocal
    config = get_settings()
    now = utcnow()
    eligible = or_(Application.status.in_(["queued", "preparing", "ready", "submitting"]),
                   and_(Application.status == "uncertain", Application.error_code == "reconciliation_requested"))
    available = or_(Application.claim_until.is_(None), Application.claim_until <= now)
    eligible = and_(eligible, or_(Application.send_after.is_(None), Application.send_after <= now))
    with session_factory() as db:
        rows = db.execute(select(Application.id, Application.version).join(User, User.id == Application.user_id)
                          .where(eligible, available, User.active.is_(True)).order_by(Application.updated_at, Application.id)
                          .execution_options(yield_per=100))
        for application_id, version in rows:
            app = db.get(Application, application_id)
            if app is None:
                continue
            user = db.get(User, app.user_id)
            if not user or not user.active:
                continue
            try:
                lock_active_user(db, user)
            except HTTPException:
                db.rollback()
                continue
            settings = automation_settings(db, app.user_id)
            if settings.paused and app.status not in {"submitting", "uncertain"}:
                continue
            # Skip quota-bound old reservations so another user's queue can advance.
            if app.status == "ready":
                today = now.replace(hour=0, minute=0, second=0, microsecond=0)
                already_reserved = app.created_at >= today or (app.submission_started_at and app.submission_started_at >= today)
                used = quota_usage(db, app.user_id, now)
                if used > settings.daily_limit or (not already_reserved and used >= settings.daily_limit):
                    continue
            token = str(uuid4())
            result = db.execute(update(Application).where(Application.id == application_id, Application.version == version, eligible, available)
                                .values(claim_token=token, claim_until=now + timedelta(seconds=config.worker_lease_seconds), version=version + 1)
                                .execution_options(synchronize_session=False))
            if result.rowcount == 1:
                db.commit()
                return application_id, token
        db.commit()
    return None


def _owned_claim(db: Session, application_id: str, token: str):
    db.expire_all()
    row = db.get(Application, application_id)
    if row is None or row.claim_token != token or not row.claim_until or row.claim_until <= utcnow():
        return None
    return row


def _prepare(db: Session, row: Application, job: Job, settings):
    transition(db, row, "preparing", "Preparing answers from the reviewed resume and profile")
    db.commit()
    token = row.claim_token
    profile_data = copy.deepcopy((row.resume_snapshot or {}).get("profile_data", {}))
    answers = {key: copy.deepcopy(value) for key, value in profile_data.items()
               if key in {"full_name", "first_name", "last_name", "email", "phone", "location", "country", "linkedin_url",
                          "website", "portfolio_url", "work_authorization", "sponsorship_required", "salary_expectation",
                          "available_start_date", "security_clearance"} and value is not None}
    if not answers.get("full_name"):
        joined = " ".join(str(profile_data.get(key) or "").strip() for key in ["first_name", "last_name"]).strip()
        if joined:
            answers["full_name"] = joined
    answers["resume_text"] = row.resume_snapshot.get("text", "")
    prefs = db.get(Preferences, row.user_id)
    match = compute_match(job, profile_data, prefs.data if prefs else {})
    row = _owned_claim(db, row.id, token)
    if row is None or row.status != "preparing":
        return
    row.answers = answers
    row.match_snapshot = copy.deepcopy(match)
    # Deliberately leave free-text claims/cover letters for user editing, rather than inventing experience.
    row.cover_letter = ""
    row.missing_fields = missing_answers(job, answers)
    row.error_code = row.error_message = None
    if not match.get("eligible", False):
        row.error_code = "eligibility_attention"
        row.error_message = "Review the eligibility requirements and update the required profile information"
    preference_issues = automatic_preference_issues(match) if row.mode == "automatic" else []
    if preference_issues:
        row.error_code = "preferences_attention"
        row.error_message = "Some saved preferences are unmatched or unconfirmed"
    if row.missing_fields or not match.get("eligible", False) or preference_issues:
        transition(db, row, "needs_attention", "Required answers or eligibility information need attention")
        notify(db, row, "needs_attention", "Application needs attention", "Complete the required information before submission.")
    elif row.mode == "review":
        transition(db, row, "needs_review", "Draft ready for user review; no submission has occurred")
        notify(db, row, "needs_review", "Application ready for review", "Review and approve the prepared answers.")
    elif match.get("score", 0) < settings.min_match_score:
        row.error_code = "match_below_minimum"
        row.error_message = "The job does not meet the current automatic match threshold"
        transition(db, row, "needs_review", "Match fell below the automatic threshold; user review is required")
    else:
        transition(db, row, "ready", "Automatic application prepared within the saved preferences")
    release(row)
    db.commit()


def _finish(application_id: str, token: str, status: str, message: str, *, confirmation=None, error_code=None, session_factory=None):
    session_factory = session_factory or SessionLocal
    if status == "applied" and (confirmation is None or not isinstance(confirmation.confirmation_id, str) or not 1 <= len(confirmation.confirmation_id.strip()) <= 200):
        status, confirmation, error_code = "uncertain", None, "invalid_confirmation"
        message = "The employer did not return a valid confirmation; reconcile before retrying"
    with session_factory() as db:
        row = _owned_claim(db, application_id, token)
        if row is None:
            return
        if row.send_after and row.send_after > utcnow():
            release(row)
            db.commit()
            return
        row.error_code = error_code
        row.error_message = message if error_code else None
        if confirmation is not None:
            row.confirmation_id = confirmation.confirmation_id
            row.submitted_at = utcnow()
        transition(db, row, status, message, data={"is_demo": confirmation.is_demo} if confirmation else None)
        release(row)
        if status in {"applied", "uncertain", "failed", "needs_attention"}:
            title = {"applied": "Demo application confirmed" if confirmation and confirmation.is_demo else "Application confirmed",
                     "uncertain": "Application outcome needs checking", "failed": "Application was not submitted", "needs_attention": "Application needs attention"}[status]
            notify(db, row, status, title, message)
        try:
            db.commit()
        except StaleDataError:
            db.rollback()


def _apply_discovery_intent(db: Session, row: Application, settings) -> bool:
    """Recheck ongoing discovery consent before preparation or submission."""
    if row.status not in {"queued", "preparing", "ready"}:
        return False
    queued = db.scalar(select(ApplicationEvent).where(ApplicationEvent.application_id == row.id,
                                                      ApplicationEvent.event_type == "queued")
                       .order_by(ApplicationEvent.sequence).limit(1))
    if queued is None or (queued.data or {}).get("source") != "automatic_discovery":
        return False
    passed = db.scalar(select(SavedJob.id).where(SavedJob.user_id == row.user_id,
                                                 SavedJob.job_id == row.job_id, SavedJob.decision == "passed"))
    if passed:
        transition(db, row, "cancelled", "The user passed this discovered job before submission")
        row.error_code = row.error_message = None
        release(row)
        db.commit()
        return True
    prefs = db.get(Preferences, row.user_id)
    if row.mode == "automatic" and (settings.mode != "automatic" or not prefs or not (prefs.data or {}).get("roles")):
        row.mode = "review"
        if row.status == "ready":
            transition(db, row, "needs_review", "Automatic discovery settings changed; review is required before submission")
            notify(db, row, "needs_review", "Application ready for review", "Your automation preferences changed. Review and approve this draft.")
            release(row)
            db.commit()
            return True
        event(db, row, "review_required", "Automatic discovery settings changed; this draft will require review")
    return False


def process_application(application_id: str, token: str, session_factory=None):
    session_factory = session_factory or SessionLocal
    config = get_settings()
    with session_factory() as db:
        row = _owned_claim(db, application_id, token)
        if row is None:
            return
        job = db.get(Job, row.job_id)
        user = db.get(User, row.user_id)
        if not user or not user.active:
            release(row)
            db.commit()
            return
        lock_active_user(db, user)
        settings = automation_settings(db, row.user_id, lock=True)
        if row.send_after and row.send_after > utcnow():
            release(row)
            db.commit()
            return
        if row.status == "submitting":
            transition(db, row, "uncertain", "The worker lease expired after submission began; reconcile before retrying")
            row.error_code = "worker_interrupted"
            row.error_message = "The employer may have received this application"
            release(row)
            db.commit()
            return
        reconciling = row.status == "uncertain" and row.error_code == "reconciliation_requested"
        if not reconciling and settings.paused:
            release(row)
            db.commit()
            return
        if job is None:
            transition(db, row, "needs_attention", "The source job is no longer available")
            row.error_code = "job_unavailable"
            release(row)
            db.commit()
            return
        if _apply_discovery_intent(db, row, settings):
            return
        if row.status in {"queued", "preparing"}:
            _prepare(db, row, job, settings)
            return
        if row.status != "ready" and not reconciling:
            release(row)
            db.commit()
            return
        try:
            connector = connector_for(row, job, config)
        except ConfirmedFailure as exc:
            target = "uncertain" if reconciling else "needs_attention"
            transition(db, row, target, "A supported employer integration is unavailable")
            row.error_code = "connector_unavailable"
            row.error_message = str(exc)
            release(row)
            db.commit()
            return
        if not reconciling:
            if not job.is_demo and not user.email_verified:
                transition(db, row, "needs_attention", "Verify your account email before submitting external applications")
                row.error_code = "email_verification_required"
                release(row)
                db.commit()
                return
            if not job.active or (job.expires_at and job.expires_at <= utcnow()):
                transition(db, row, "needs_attention", "This job is no longer accepting applications")
                row.error_code = "job_unavailable"
                release(row)
                db.commit()
                return
            row.missing_fields = missing_answers(job, row.answers, row.cover_letter)
            profile_data = copy.deepcopy(row.resume_snapshot.get("profile_data", {}))
            profile_data.update({key: value for key, value in row.answers.items() if key != "resume_text"})
            prefs = db.get(Preferences, row.user_id)
            match = compute_match(job, profile_data, prefs.data if prefs else {})
            row.match_snapshot = copy.deepcopy(match)
            if row.missing_fields or not match.get("eligible", False):
                transition(db, row, "needs_attention", "Required answers or eligibility information need attention")
                row.error_code = "eligibility_attention"
                release(row)
                db.commit()
                return
            if row.mode == "automatic" and automatic_preference_issues(match):
                transition(db, row, "needs_attention", "Some saved preferences are unmatched or unconfirmed")
                row.error_code = "preferences_attention"
                release(row)
                db.commit()
                return
            if row.mode == "automatic" and match.get("score", 0) < settings.min_match_score:
                transition(db, row, "needs_review", "The current automatic match threshold requires manual review")
                release(row)
                db.commit()
                return
            if row.attempts >= config.max_application_attempts:
                transition(db, row, "failed", "This application has reached its attempt limit")
                row.error_code = "attempt_limit_reached"
                release(row)
                db.commit()
                return
            now = utcnow()
            today = now.replace(hour=0, minute=0, second=0, microsecond=0)
            already_reserved = row.created_at >= today or (row.submission_started_at and row.submission_started_at >= today)
            used = quota_usage(db, row.user_id, now)
            if used > settings.daily_limit or (not already_reserved and used >= settings.daily_limit):
                release(row)
                event(db, row, "daily_limit_wait", "Waiting for capacity within your daily limit")
                db.commit()
                return
            row.attempts += 1
            row.submission_started_at = now
            transition(db, row, "submitting", "Sending to the local demo employer fixture" if job.is_demo else "Sending to the configured employer integration")
        else:
            event(db, row, "reconciling", "Looking up the employer receipt without resubmitting")
        # Persist submission_started before I/O. Expired submitting leases become uncertain.
        db.commit()
        db.refresh(row)
        db.refresh(job)
        db.expunge(row)
        db.expunge(job)
    # Administrative changes may become visible only at the post-commit refresh.
    # Rebuild from the refreshed job before any adapter I/O; never use the stale
    # connector instance to submit or reconcile through a removed integration.
    try:
        connector = connector_for(row, job, get_settings())
    except ConfirmedFailure:
        _finish(application_id, token, "uncertain" if reconciling else "needs_attention",
                "The employer integration changed before this operation; no adapter request was sent",
                error_code="connector_unavailable", session_factory=session_factory)
        return
    try:
        def heartbeat():
            with session_factory() as lease_db:
                lease_db.execute(update(Application).where(Application.id == application_id, Application.claim_token == token)
                    .values(claim_until=utcnow() + timedelta(seconds=config.worker_lease_seconds)))
                lease_db.commit()
        with live_io(row.user_id, heartbeat, interval=min(10, config.worker_lease_seconds / 3)):
            confirmation = connector.reconcile(row, job) if reconciling else connector.submit(row, job)
        _finish(application_id, token, "applied", "Local demo employer fixture confirmed a simulated submission" if confirmation.is_demo else "Employer confirmed submission",
                confirmation=confirmation, session_factory=session_factory)
    except ApplicationAttention:
        _finish(application_id, token, "needs_attention", "The employer form requires user or integration configuration attention; nothing was submitted",
                error_code="form_attention", session_factory=session_factory)
    except ConfirmedFailure:
        _finish(application_id, token, "failed", "The employer confirmed that no application was submitted", error_code="confirmed_not_submitted", session_factory=session_factory)
    except UncertainSubmission:
        _finish(application_id, token, "uncertain", "The outcome is unknown; request reconciliation before retrying",
                error_code="submission_uncertain", session_factory=session_factory)
    except Exception:
        # Once submission has started, even an unexpected exception must not cause a blind resend.
        _finish(application_id, token, "uncertain", "The submission worker was interrupted; reconcile before retrying",
                error_code="worker_error", session_factory=session_factory)


def run_worker_once(session_factory=None, max_items: int = 100) -> int:
    session_factory = session_factory or SessionLocal
    from app.domain.product import deliver_task_reminders
    deliver_task_reminders(session_factory)
    from app.domain.account import cleanup_pending
    cleanup_pending(session_factory)
    if max_items <= 0:
        return 0
    max_items = min(max_items, 1000)
    discover_automatic_applications(session_factory, max_created=max_items)
    processed = 0
    for _ in range(max_items):
        claim = claim_next(session_factory)
        if claim is None:
            break
        try:
            process_application(*claim, session_factory=session_factory)
        except Exception:
            with session_factory() as db:
                row = _owned_claim(db, *claim)
                if row:
                    if row.status == "submitting":
                        target, code = "uncertain", "worker_error"
                    else:
                        target, code = "failed", "preparation_failed"
                        row.attempts += 1
                    row.error_code = code
                    row.error_message = "The worker could not complete this operation"
                    transition(db, row, target, row.error_message)
                    release(row)
                    db.commit()
        processed += 1
    return processed


def build_celery_app():
    from celery import Celery
    config = get_settings()
    app = Celery("job_applications", broker=config.redis_url or "redis://localhost:6379/0")
    app.conf.update(task_acks_late=True, worker_prefetch_multiplier=1,
                    beat_schedule={"poll-durable-applications": {"task": "applications.drain", "schedule": 5.0}})

    @app.task(name="applications.drain")
    def drain():
        return run_worker_once()

    return app


try:
    celery_app = build_celery_app()
except ImportError:
    celery_app = None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    parser.add_argument("--max-items", type=int, default=100)
    args = parser.parse_args()
    if not 0.1 <= args.poll_seconds <= 60 or not 1 <= args.max_items <= 1000:
        parser.error("poll-seconds must be 0.1–60 and max-items must be 1–1000")
    migrate_db()
    while True:
        processed = run_worker_once(max_items=args.max_items)
        if args.once:
            print(json.dumps({"processed": processed}))
            return
        if not processed:
            time.sleep(args.poll_seconds)


if __name__ == "__main__":
    # Browser connectors import the canonical module's exception types. Dispatch
    # through that module so CLI and Celery use the same exception identities.
    from app.workers import main as worker_main
    worker_main()
