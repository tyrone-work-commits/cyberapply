"""Private account export and durable data erasure, excluding authentication secrets."""
import json
import re
import tempfile
import zipfile
from datetime import timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.operations import user_has_live_io
from app.core.security import get_current_user
from app.core.storage import Storage
from app.core.time import utcnow
from app.domain.applications import iso
from app.domain.mfa import Proof, require_proof, revoke_security_sessions
from app.models import (
    AccountDeletion,
    AccountSettings,
    Application,
    ApplicationEvent,
    ApplicationTask,
    AuthChallenge,
    AutomationSettings,
    CompanyFollow,
    Document,
    InboxMessage,
    Job,
    MailConnection,
    MailDraft,
    MfaFactor,
    Notification,
    Preferences,
    Profile,
    RefreshSession,
    Resume,
    SavedJob,
    SupportProblem,
    User,
    VerificationToken,
)

router = APIRouter(prefix="/account", tags=["Account data"])


class ExportInput(Proof):
    include_files: bool = True


class DeleteInput(Proof):
    confirmation: Literal["DELETE MY ACCOUNT"]


EXPORT_MODELS = [Profile, Preferences, AccountSettings, AutomationSettings, Resume, Document, Job,
                 SavedJob, CompanyFollow, Application, ApplicationEvent, ApplicationTask,
                 MailConnection, InboxMessage, MailDraft, Notification, SupportProblem]
PRIVATE_COLUMNS = {"storage_key", "secret_encrypted", "claim_token", "claim_until", "idempotency_key", "send_key"}


def exported_row(row):
    result = {}
    for column in row.__table__.columns:
        if column.name in PRIVATE_COLUMNS:
            continue
        value = getattr(row, column.name)
        result[column.name] = iso(value) if hasattr(value, "isoformat") else value
    return result


@router.post("/export")
def export_account(payload: ExportInput, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_proof(db, user, payload, request)
    data = {"format_version": 1, "exported_at": iso(utcnow()),
            "account": {"id": user.id, "email": user.email, "phone": user.phone, "email_verified": user.email_verified},
            "note": "Authentication codes, passwords, session tokens and mailbox credentials are excluded."}
    documents = []
    for model in EXPORT_MODELS:
        owner = model.owner_id if model is Job else model.user_id
        rows = db.scalars(select(model).where(owner == user.id)).all()
        data[model.__tablename__] = [exported_row(row) for row in rows]
        if model is Document:
            documents = rows
    # Include referenced public listings without another account's private data.
    references = {row["job_id"] for row in data["applications"] + data["saved_jobs"]}
    data["referenced_jobs"] = [exported_row(row) for row in db.scalars(select(Job).where(Job.id.in_(references),
        or_(Job.owner_id.is_(None), Job.owner_id == user.id)))] if references else []
    stream = tempfile.SpooledTemporaryFile(max_size=4 * 1024 * 1024)
    try:
        with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("cyberapply-data.json", json.dumps(data, ensure_ascii=False, allow_nan=False, indent=2))
            if payload.include_files:
                storage = Storage()
                for document in documents:
                    name = re.sub(r"[^A-Za-z0-9._ -]", "_", document.filename).strip(" .") or "document"
                    archive.writestr("documents/" + document.id + "/" + name[:180], storage.get(document.storage_key))
        db.commit()
        stream.seek(0)
    except Exception:
        stream.close()
        raise
    def chunks():
        try:
            while chunk := stream.read(65536):
                yield chunk
        finally:
            stream.close()
    return StreamingResponse(chunks(), media_type="application/zip", headers={
        "Content-Disposition": 'attachment; filename="cyberapply-data.zip"', "Cache-Control": "private, no-store"})


def deletion_busy(db, user_id):
    if user_has_live_io(user_id):
        return True
    # Expired I/O leases cannot keep a disabled account in cleanup forever.
    db.execute(update(Application).where(Application.user_id == user_id, Application.status == "submitting",
        or_(Application.claim_until < utcnow() - timedelta(minutes=5), and_(Application.claim_until.is_(None), Application.updated_at < utcnow() - timedelta(minutes=5))))
        .values(status="uncertain", claim_token=None, claim_until=None, error_code="worker_interrupted"))
    db.execute(update(MailDraft).where(MailDraft.user_id == user_id, MailDraft.status == "sending",
        MailDraft.updated_at < utcnow() - timedelta(minutes=5)).values(status="delivery_unknown"))
    claimed = and_(Application.claim_token.is_not(None), Application.claim_until > utcnow())
    applications = db.scalar(select(Application.id).where(Application.user_id == user_id,
        or_(Application.status == "submitting", claimed)).limit(1))
    mail = db.scalar(select(MailDraft.id).where(MailDraft.user_id == user_id, MailDraft.status == "sending").limit(1))
    return bool(applications or mail)


@router.delete("", status_code=202)
def delete_account(payload: DeleteInput, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_proof(db, user, payload, request)
    row = db.get(AccountDeletion, user.id)
    if row is None:
        row = AccountDeletion(user_id=user.id,
            storage_keys=list(db.scalars(select(Document.storage_key).where(Document.user_id == user.id))),
            captured_email=user.email, status="pending")
        db.add(row)
    settings = db.get(AutomationSettings, user.id)
    if settings:
        settings.paused = True
    user.active = False
    revoke_security_sessions(db, user)
    user.revoked_before = int(utcnow().replace(tzinfo=timezone.utc).timestamp())
    user.email = user.phone = user.password_hash = None
    user.email_verified = False
    db.commit()  # Stop new sessions/work before cleanup. In-flight work is never erased mid-send.
    cleanup_account(db, user.id)
    row = db.get(AccountDeletion, user.id)
    return {"status": row.status, "account_disabled": True,
            "message": "Your CyberApply data has been deleted." if row.status == "complete" else "Your account is disabled. Cleanup will finish when active work and private storage are available.",
            "provider_identity": "External Google/Apple identities are managed by their provider."}


def cleanup_account(db, user_id):
    row = db.get(AccountDeletion, user_id)
    if not row or row.status == "complete" or deletion_busy(db, user_id):
        return
    storage = Storage()
    try:
        for key in row.storage_keys:
            storage.delete(key)
        if row.captured_email:
            directory = storage.settings.storage_dir.parent / "auth-outbox"
            if directory.is_dir():
                for path in directory.glob("*.json"):
                    try:
                        captured = json.loads(path.read_text(encoding="utf-8"))
                    except (ValueError, OSError):
                        continue
                    if not isinstance(captured, dict):
                        continue
                    recipient = captured.get("recipient")
                    legacy_owned = not captured.get("user_id") and isinstance(recipient, str) and path.stat().st_mtime <= row.requested_at.replace(tzinfo=timezone.utc).timestamp() and recipient.casefold() == row.captured_email.casefold()
                    if captured.get("user_id") == user_id or legacy_owned:
                        path.unlink(missing_ok=True)
        # Ordered deletion handles RESTRICT FKs; provider subjects remain disabled tombstones.
        order = [ApplicationTask, ApplicationEvent, Notification, InboxMessage, MailDraft, Application,
                 Resume, Document, SavedJob, CompanyFollow, Job, MailConnection, SupportProblem,
                 AuthChallenge, RefreshSession, VerificationToken, MfaFactor, AccountSettings,
                 AutomationSettings, Preferences, Profile]
        for model in order:
            owner = model.owner_id if model is Job else model.user_id
            db.execute(delete(model).where(owner == user_id))
        user = db.get(User, user_id)
        user.email = user.phone = user.password_hash = None
        user.email_verified = False
        row.status, row.storage_keys, row.captured_email, row.error = "complete", [], None, None
        db.commit()
    except Exception:
        db.rollback()
        row = db.get(AccountDeletion, user_id)
        row.error = "Private data cleanup will retry; some storage or records are temporarily unavailable"
        db.commit()


def cleanup_pending(session_factory):
    with session_factory() as db:
        users = list(db.scalars(select(AccountDeletion.user_id).where(AccountDeletion.status == "pending").limit(20)))
        for user_id in users:
            cleanup_account(db, user_id)
