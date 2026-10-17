"""Private employer inbox, connection management, and an explicit mail outbox."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import fail
from app.core.operations import live_io
from app.core.security import SecretBox, get_current_user
from app.core.storage import Storage
from app.core.time import utcnow
from app.models import Application, Document, InboxMessage, Job, MailConnection, MailDraft, Notification, User
from app.services import mail

router = APIRouter(tags=["inbox"])
Category = Literal["primary", "verification", "interview", "offer", "rejection", "assessment", "confirmation", "onboarding", "reminder"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    application_id: str | None
    connection_id: str | None
    sender: str
    recipient: str
    subject: str
    body: str
    category: str
    is_read: bool
    starred: bool
    archived: bool
    received_at: datetime
    created_at: datetime


class MessagePatch(StrictModel):
    is_read: bool | None = None
    starred: bool | None = None
    archived: bool | None = None
    category: Category | None = None
    application_id: str | None = Field(default=None, max_length=36)


class ConnectionCreate(StrictModel):
    provider: Literal["gmail", "microsoft", "yahoo"]
    email: EmailStr
    password: str = Field(min_length=1, max_length=2048, repr=False)


class ConnectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    provider: str
    email: str
    active: bool
    last_synced_at: datetime | None
    created_at: datetime


class DraftCreate(StrictModel):
    application_id: str | None = Field(default=None, max_length=36)
    connection_id: str | None = Field(default=None, max_length=36)
    recipient: EmailStr
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1, max_length=100_000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("subject")
    @classmethod
    def valid_subject(cls, value):
        value = mail.validate_header(value).strip()
        if not value:
            raise ValueError("A subject is required.")
        return value

    @field_validator("body")
    @classmethod
    def valid_body(cls, value):
        if not value.strip() or "\x00" in value:
            raise ValueError("A message body without null characters is required.")
        return value


class DraftPatch(StrictModel):
    application_id: str | None = Field(default=None, max_length=36)
    connection_id: str | None = Field(default=None, max_length=36)
    recipient: EmailStr | None = None
    subject: str | None = Field(default=None, min_length=1, max_length=500)
    body: str | None = Field(default=None, min_length=1, max_length=100_000)
    attachment_ids: list[str] | None = Field(default=None, max_length=10)

    @field_validator("subject")
    @classmethod
    def valid_subject(cls, value):
        if value is None:
            return value
        value = mail.validate_header(value).strip()
        if not value:
            raise ValueError("A subject is required.")
        return value

    @field_validator("body")
    @classmethod
    def valid_body(cls, value):
        if value is not None and (not value.strip() or "\x00" in value):
            raise ValueError("A message body without null characters is required.")
        return value


class DraftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    application_id: str | None
    connection_id: str | None
    recipient: str
    subject: str
    body: str
    attachment_ids: list[str]
    status: str
    error: str | None
    sent_at: datetime | None
    created_at: datetime
    updated_at: datetime


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    application_id: str | None
    kind: str
    title: str
    body: str
    is_read: bool
    created_at: datetime


class NotificationPatch(StrictModel):
    is_read: bool


def owned(db: Session, model, object_id: str, user_id: str):
    row = db.scalar(select(model).where(model.id == object_id, model.user_id == user_id))
    if row is None:
        fail(404, "not_found", "Resource not found.")
    return row


def check_application(db: Session, application_id: str | None, user_id: str):
    if application_id is not None:
        owned(db, Application, application_id, user_id)


def enabled_providers() -> list[str]:
    allowed = {host.casefold() for host in get_settings().mail_allowed_hosts}
    return [name for name, endpoints in mail.PROVIDERS.items() if str(endpoints["imap"]).casefold() in allowed and str(endpoints["smtp"]).casefold() in allowed]


def check_connection(db: Session, connection_id: str | None, user_id: str):
    if connection_id is None:
        return None
    connection = owned(db, MailConnection, connection_id, user_id)
    if not connection.active:
        fail(409, "connection_inactive", "This mail connection is inactive.")
    if connection.provider not in enabled_providers():
        fail(409, "provider_disabled", "This mail provider is disabled by the server.")
    return connection


def attachment_documents(db: Session, attachment_ids: list[str], user_id: str) -> list[Document]:
    if len(attachment_ids) != len(set(attachment_ids)):
        fail(422, "duplicate_attachment", "Attachment IDs must be unique.")
    documents = [owned(db, Document, identifier, user_id) for identifier in attachment_ids]
    if sum(document.size_bytes for document in documents) > get_settings().max_upload_bytes:
        fail(413, "attachments_too_large", "Combined attachments exceed the upload size limit.")
    return documents


def recover_interrupted_send(db: Session, draft: MailDraft) -> MailDraft:
    if draft.status == "sending" and draft.updated_at < utcnow() - timedelta(minutes=5):
        result = db.execute(update(MailDraft).where(MailDraft.id == draft.id, MailDraft.status == "sending", MailDraft.updated_at < utcnow() - timedelta(minutes=5)).values(status="delivery_unknown", error="The backend stopped before delivery could be confirmed. Check the mailbox before sending another message.", updated_at=utcnow()))
        if result.rowcount:
            db.commit()
            db.refresh(draft)
    return draft


def application_for_message(db: Session, user_id: str, message: mail.FetchedMessage) -> str | None:
    """Only link a unique application supported by an explicit textual match."""
    candidates = db.execute(
        select(Application.id, Job.title, Job.company, Job.attributes)
        .join(Job, Application.job_id == Job.id)
        .where(Application.user_id == user_id)
        .order_by(Application.created_at.desc()).limit(1000)
    ).all()
    text = (message.subject + "\n" + message.body[:5000]).casefold()
    sender_domain = message.sender_email.rsplit("@", 1)[-1].casefold()
    matches = []
    for application_id, title, company, attributes in candidates:
        domain = str((attributes or {}).get("employer_domain", "")).casefold()
        names = [name.casefold().strip() for name in (company, title) if name and len(name.strip()) >= 5]
        if (domain and sender_domain == domain) or any(re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", text) for name in names):
            matches.append(application_id)
    return matches[0] if len(matches) == 1 else None


@router.get("/inbox/categories")
def categories(user: User = Depends(get_current_user)):
    return {"categories": list(mail.CATEGORIES)}


@router.get("/inbox/messages")
def list_messages(
    category: Category | None = None, search: str | None = Query(default=None, max_length=200),
    is_read: bool | None = None, starred: bool | None = None, archived: bool = False,
    application_id: str | None = Query(default=None, max_length=36),
    limit: int = Query(default=30, ge=1, le=100), offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    check_application(db, application_id, user.id)
    filters = [InboxMessage.user_id == user.id, InboxMessage.archived == archived]
    if category:
        filters.append(InboxMessage.category == category)
    if is_read is not None:
        filters.append(InboxMessage.is_read == is_read)
    if starred is not None:
        filters.append(InboxMessage.starred == starred)
    if application_id is not None:
        filters.append(InboxMessage.application_id == application_id)
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        filters.append(or_(InboxMessage.subject.ilike(f"%{escaped}%", escape="\\"), InboxMessage.sender.ilike(f"%{escaped}%", escape="\\"), InboxMessage.body.ilike(f"%{escaped}%", escape="\\")))
    total = db.scalar(select(func.count()).select_from(InboxMessage).where(*filters))
    messages = db.scalars(select(InboxMessage).where(*filters).order_by(InboxMessage.received_at.desc(), InboxMessage.id).offset(offset).limit(limit)).all()
    return {"items": [MessageOut.model_validate(message) for message in messages], "total": total, "limit": limit, "offset": offset}


@router.get("/inbox/summary")
def inbox_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.execute(select(InboxMessage.category, InboxMessage.is_read, func.count()).where(InboxMessage.user_id == user.id, InboxMessage.archived.is_(False)).group_by(InboxMessage.category, InboxMessage.is_read)).all()
    counts = {category: {"total": 0, "unread": 0} for category in mail.CATEGORIES}
    for category, is_read, count in rows:
        if category not in counts:
            continue
        counts[category]["total"] += count
        if not is_read:
            counts[category]["unread"] += count
    return {"categories": counts, "total": sum(item["total"] for item in counts.values()), "unread": sum(item["unread"] for item in counts.values())}


@router.get("/inbox/messages/{message_id}", response_model=MessageOut)
def get_message(message_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return owned(db, InboxMessage, message_id, user.id)


@router.patch("/inbox/messages/{message_id}", response_model=MessageOut)
def update_message(message_id: str, payload: MessagePatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    message = owned(db, InboxMessage, message_id, user.id)
    data = payload.model_dump(exclude_unset=True)
    check_application(db, data.get("application_id"), user.id)
    for key, value in data.items():
        if key != "application_id" and value is None:
            fail(422, "invalid_update", "Only application_id may be cleared.")
        setattr(message, key, value)
    db.commit()
    db.refresh(message)
    return message


@router.get("/inbox/connections")
def list_connections(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    connections = db.scalars(select(MailConnection).where(MailConnection.user_id == user.id, MailConnection.active.is_(True)).order_by(MailConnection.created_at.desc())).all()
    return {"items": [ConnectionOut.model_validate(connection) for connection in connections], "mode": get_settings().mail_mode, "enabled_providers": enabled_providers()}


@router.post("/inbox/connections", response_model=ConnectionOut, status_code=201)
def create_connection(payload: ConnectionCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.provider not in enabled_providers():
        fail(422, "provider_disabled", "This mail provider is disabled by the server.")
    existing = db.scalar(select(MailConnection).where(MailConnection.user_id == user.id, MailConnection.email == str(payload.email), MailConnection.active.is_(True)))
    if existing:
        fail(409, "connection_exists", "An active connection already exists for this address.")
    endpoints = mail.PROVIDERS[payload.provider]
    connection = MailConnection(
        user_id=user.id, provider=payload.provider, email=str(payload.email),
        imap_host=endpoints["imap"], smtp_host=endpoints["smtp"], imap_port=993,
        smtp_port=endpoints["smtp_port"], secret_encrypted=SecretBox().encrypt(payload.password), sync_cursor={},
    )
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


@router.delete("/inbox/connections/{connection_id}", status_code=204)
def delete_connection(connection_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    connection = owned(db, MailConnection, connection_id, user.id)
    # Preserve message references while removing usable credentials immediately.
    connection.active = False
    connection.secret_encrypted = ""
    connection.sync_cursor = {}
    db.commit()


@router.post("/inbox/connections/{connection_id}/sync")
def sync_connection(
    connection_id: str, limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    connection = check_connection(db, connection_id, user.id)
    settings = get_settings()
    if settings.mail_mode == "demo":
        return {"status": "demo_no_network", "imported": 0, "message": "Demo mode does not access a real mailbox."}
    cursor = connection.sync_cursor or {}
    try:
        messages, next_cursor = mail.sync_inbox(
            provider=connection.provider, allowed_providers=enabled_providers(),
            username=connection.email, password=SecretBox().decrypt(connection.secret_encrypted),
            enabled=settings.mail_mode == "smtp", after_uid=int(cursor.get("last_uid", 0)),
            uidvalidity=cursor.get("uidvalidity"), limit=limit, timeout=settings.mail_timeout_seconds,
        )
    except (mail.MailConfigurationError, mail.MailSyncError):
        fail(502, "mailbox_sync_failed", "Mailbox sync failed. Check provider configuration and credentials.")
    imported = 0
    for message in messages:
        external_id = f"{next_cursor['uidvalidity']}:{message.uid}"
        exists = db.scalar(select(InboxMessage.id).where(InboxMessage.user_id == user.id, InboxMessage.connection_id == connection.id, InboxMessage.external_id == external_id))
        if exists:
            continue
        application_id = application_for_message(db, user.id, message)
        db.add(InboxMessage(
            user_id=user.id, application_id=application_id, connection_id=connection.id,
            external_id=external_id, sender=message.sender_email, recipient=message.recipient_email,
            subject=message.subject, body=message.body, category=message.category,
            received_at=message.received_at.replace(tzinfo=None),
        ))
        db.add(Notification(user_id=user.id, application_id=application_id, kind="inbox", title="New employer message", body=message.subject[:500]))
        imported += 1
    connection.sync_cursor = next_cursor
    connection.last_synced_at = utcnow()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        fail(409, "sync_conflict", "Another mailbox sync ran concurrently. Retry this sync.")
    return {"status": "synced", "imported": imported, "last_synced_at": connection.last_synced_at}


@router.get("/inbox/drafts")
def list_drafts(
    status: Literal["draft", "sending", "captured", "sent", "failed", "delivery_unknown"] | None = None,
    application_id: str | None = Query(default=None, max_length=36),
    limit: int = Query(default=30, ge=1, le=100), offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    filters = [MailDraft.user_id == user.id]
    check_application(db, application_id, user.id)
    if status is not None:
        filters.append(MailDraft.status == status)
    if application_id is not None:
        filters.append(MailDraft.application_id == application_id)
    total = db.scalar(select(func.count()).select_from(MailDraft).where(*filters))
    drafts = db.scalars(select(MailDraft).where(*filters).order_by(MailDraft.updated_at.desc(), MailDraft.id).offset(offset).limit(limit)).all()
    return {"items": [DraftOut.model_validate(recover_interrupted_send(db, draft)) for draft in drafts], "total": total, "limit": limit, "offset": offset}


@router.post("/inbox/drafts", response_model=DraftOut, status_code=201)
def create_draft(payload: DraftCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check_application(db, payload.application_id, user.id)
    check_connection(db, payload.connection_id, user.id)
    attachment_documents(db, payload.attachment_ids, user.id)
    draft = MailDraft(user_id=user.id, **payload.model_dump(mode="json"))
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return draft


@router.get("/inbox/drafts/{draft_id}", response_model=DraftOut)
def get_draft(draft_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return recover_interrupted_send(db, owned(db, MailDraft, draft_id, user.id))


@router.patch("/inbox/drafts/{draft_id}", response_model=DraftOut)
def update_draft(draft_id: str, payload: DraftPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    draft = owned(db, MailDraft, draft_id, user.id)
    if draft.status != "draft":
        fail(409, "draft_locked", "Only unsent drafts may be edited. Create a new draft instead.")
    data = payload.model_dump(exclude_unset=True, mode="json")
    check_application(db, data.get("application_id"), user.id)
    check_connection(db, data.get("connection_id"), user.id)
    if "attachment_ids" in data:
        if data["attachment_ids"] is None:
            fail(422, "invalid_update", "attachment_ids must be a list.")
        attachment_documents(db, data["attachment_ids"], user.id)
    for key, value in data.items():
        if value is None and key not in ("application_id", "connection_id"):
            fail(422, "invalid_update", "This field cannot be cleared.")
    result = db.execute(update(MailDraft).where(MailDraft.id == draft.id, MailDraft.user_id == user.id, MailDraft.status == "draft", MailDraft.send_key.is_(None)).values(**data, updated_at=utcnow()))
    if result.rowcount != 1:
        db.rollback()
        fail(409, "draft_locked", "This draft is already being processed.")
    db.commit()
    db.refresh(draft)
    return draft


@router.delete("/inbox/drafts/{draft_id}", status_code=204)
def delete_draft(draft_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    draft = owned(db, MailDraft, draft_id, user.id)
    if draft.status != "draft":
        fail(409, "draft_locked", "Only unsent drafts may be deleted.")
    result = db.execute(delete(MailDraft).where(MailDraft.id == draft.id, MailDraft.user_id == user.id, MailDraft.status == "draft", MailDraft.send_key.is_(None)))
    if result.rowcount != 1:
        db.rollback()
        fail(409, "draft_locked", "This draft is already being processed.")
    db.commit()


@router.post("/inbox/drafts/{draft_id}/send", response_model=DraftOut)
def send_draft(
    draft_id: str, idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=128),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    draft = recover_interrupted_send(db, owned(db, MailDraft, draft_id, user.id))
    key = hashlib.sha256(f"{user.id}:{idempotency_key}".encode()).hexdigest()
    if draft.send_key == key:
        return draft
    if draft.status != "draft":
        fail(409, "draft_locked", "This draft has already been processed. Its outcome must be reviewed before sending another message.")
    documents = attachment_documents(db, draft.attachment_ids, user.id)
    settings = get_settings()
    connection = check_connection(db, draft.connection_id, user.id)
    if settings.mail_mode == "smtp" and connection is None:
        fail(409, "mail_connection_required", "Select a connected mailbox before sending.")
    password = SecretBox().decrypt(connection.secret_encrypted) if settings.mail_mode == "smtp" else None
    attachments = []
    try:
        storage = Storage()
        attachments = [(document.filename, storage.get(document.storage_key), document.content_type) for document in documents]
    except (OSError, ValueError):
        fail(409, "attachment_unavailable", "One or more attachments are unavailable.")
    if sum(len(data) for _, data, _ in attachments) > settings.max_upload_bytes:
        fail(413, "attachments_too_large", "Combined attachments exceed the upload size limit.")
    try:
        claimed = db.execute(update(MailDraft).where(MailDraft.id == draft.id, MailDraft.user_id == user.id, MailDraft.status == "draft", MailDraft.send_key.is_(None)).values(status="sending", send_key=key, updated_at=utcnow()))
        if claimed.rowcount != 1:
            db.rollback()
            fail(409, "send_in_progress", "This draft is already being processed.")
        db.commit()
    except IntegrityError:
        db.rollback()
        fail(409, "idempotency_conflict", "This idempotency key was used for a different draft.")
    db.refresh(draft)
    if settings.mail_mode == "demo":
        draft.status = "captured"
        draft.error = None
        # captured is an outbox preview; sent_at deliberately remains null.
    else:
        try:
            with live_io(user.id):
                mail.send_message(
                    provider=connection.provider, allowed_providers=enabled_providers(), username=connection.email,
                    password=password, recipient=draft.recipient,
                    subject=draft.subject, body=draft.body, message_id=f"<{key}@local.cyberapply>",
                    attachments=attachments, enabled=True, timeout=settings.mail_timeout_seconds,
                )
            draft.status = "sent"
            draft.sent_at = utcnow()
            draft.error = None
        except mail.MailDeliveryError as error:
            draft.status = "delivery_unknown" if error.delivery_unknown else "failed"
            draft.error = "Delivery could not be confirmed. Do not resend without checking the mailbox." if error.delivery_unknown else "Delivery failed. Check credentials and provider settings before creating a new draft."
        except (mail.MailConfigurationError, ValueError):
            draft.status = "failed"
            draft.error = "Mail connection configuration could not be used."
    draft.updated_at = utcnow()
    db.commit()
    db.refresh(draft)
    return draft


@router.get("/notifications")
def list_notifications(
    is_read: bool | None = None, limit: int = Query(default=30, ge=1, le=100), offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    filters = [Notification.user_id == user.id]
    if is_read is not None:
        filters.append(Notification.is_read == is_read)
    total = db.scalar(select(func.count()).select_from(Notification).where(*filters))
    items = db.scalars(select(Notification).where(*filters).order_by(Notification.created_at.desc(), Notification.id).offset(offset).limit(limit)).all()
    return {"items": [NotificationOut.model_validate(item) for item in items], "total": total, "limit": limit, "offset": offset}


@router.post("/notifications/read-all")
def read_all_notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = db.execute(update(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False)).values(is_read=True))
    db.commit()
    return {"updated": result.rowcount}


@router.patch("/notifications/{notification_id}", response_model=NotificationOut)
def update_notification(notification_id: str, payload: NotificationPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    notification = owned(db, Notification, notification_id, user.id)
    notification.is_read = payload.is_read
    db.commit()
    db.refresh(notification)
    return notification
