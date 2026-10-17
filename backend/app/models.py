from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.time import utcnow


def uid():
    return str(uuid4())


class Identity:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)


class Created:
    created_at: Mapped[object] = mapped_column(DateTime, default=utcnow)


class Updated:
    updated_at: Mapped[object] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class User(Identity, Created, Base):
    __tablename__ = "users"
    email: Mapped[str | None] = mapped_column(String(320), unique=True)
    phone: Mapped[str | None] = mapped_column(String(30), unique=True)
    password_hash: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    revoked_before: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Profile(Updated, Base):
    __tablename__ = "profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)


class Preferences(Updated, Base):
    __tablename__ = "preferences"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class Document(Identity, Created, Base):
    __tablename__ = "documents"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(50), default="resume")
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(150))
    storage_key: Mapped[str] = mapped_column(String(500), unique=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))


class Resume(Identity, Created, Updated, Base):
    __tablename__ = "resumes"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(255), default="My resume")
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    profile_data: Mapped[dict] = mapped_column(JSON, default=dict)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    is_main: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    target_role: Mapped[str] = mapped_column(String(300), default="", server_default="")


class Job(Identity, Created, Updated, Base):
    __tablename__ = "jobs"
    __table_args__ = (UniqueConstraint("owner_id", "source", "source_id"),)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(50), default="manual")
    source_id: Mapped[str] = mapped_column(String(200), default=uid)
    title: Mapped[str] = mapped_column(String(300))
    company: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    location: Mapped[str] = mapped_column(String(200), default="")
    remote: Mapped[bool] = mapped_column(Boolean, default=False)
    employment_type: Mapped[str] = mapped_column(String(50), default="full_time")
    level: Mapped[str] = mapped_column(String(50), default="mid")
    salary_min: Mapped[float | None] = mapped_column(Float)
    salary_max: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    required_skills: Mapped[list] = mapped_column(JSON, default=list)
    required_certifications: Mapped[list] = mapped_column(JSON, default=list)
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)
    source_url: Mapped[str] = mapped_column(Text, default="")
    apply_url: Mapped[str] = mapped_column(Text, default="")
    connector_key: Mapped[str] = mapped_column(String(50), default="unsupported")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[object | None] = mapped_column(DateTime)


class SavedJob(Identity, Created, Base):
    __tablename__ = "saved_jobs"
    __table_args__ = (UniqueConstraint("user_id", "job_id"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"))
    decision: Mapped[str] = mapped_column(String(30), default="saved")


class CompanyFollow(Identity, Created, Base):
    __tablename__ = "company_follows"
    __table_args__ = (UniqueConstraint("user_id", "company"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    company: Mapped[str] = mapped_column(String(200))


class AutomationSettings(Updated, Base):
    __tablename__ = "automation_settings"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    mode: Mapped[str] = mapped_column(String(30), default="review")
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    daily_limit: Mapped[int] = mapped_column(Integer, default=10)
    min_match_score: Mapped[int] = mapped_column(Integer, default=60)
    discovery_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    discovery_cursor: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")


class Application(Identity, Created, Updated, Base):
    __tablename__ = "applications"
    __table_args__ = (UniqueConstraint("user_id", "job_id"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"))
    resume_id: Mapped[str] = mapped_column(ForeignKey("resumes.id", ondelete="RESTRICT"))
    mode: Mapped[str] = mapped_column(String(30), default="review")
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    outcome: Mapped[str | None] = mapped_column(String(30))
    resume_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    answers: Mapped[dict] = mapped_column(JSON, default=dict)
    cover_letter: Mapped[str] = mapped_column(Text, default="")
    match_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    missing_fields: Mapped[list] = mapped_column(JSON, default=list)
    connector_key: Mapped[str] = mapped_column(String(50), default="unsupported")
    confirmation_id: Mapped[str | None] = mapped_column(String(300))
    error_code: Mapped[str | None] = mapped_column(String(100))
    error_message: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True, default=uid)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    claim_token: Mapped[str | None] = mapped_column(String(100))
    claim_until: Mapped[object | None] = mapped_column(DateTime)
    submission_started_at: Mapped[object | None] = mapped_column(DateTime)
    submitted_at: Mapped[object | None] = mapped_column(DateTime)
    send_after: Mapped[datetime | None] = mapped_column(DateTime)
    __mapper_args__ = {"version_id_col": version}


class ApplicationEvent(Identity, Created, Base):
    __tablename__ = "application_events"
    __table_args__ = (UniqueConstraint("application_id", "sequence", name="uq_application_event_sequence"),)
    sequence: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(100))
    from_status: Mapped[str | None] = mapped_column(String(40))
    to_status: Mapped[str | None] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class MailConnection(Identity, Created, Base):
    __tablename__ = "mail_connections"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(50))
    email: Mapped[str] = mapped_column(String(320))
    imap_host: Mapped[str] = mapped_column(String(255))
    smtp_host: Mapped[str] = mapped_column(String(255))
    imap_port: Mapped[int] = mapped_column(Integer, default=993)
    smtp_port: Mapped[int] = mapped_column(Integer, default=465)
    secret_encrypted: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_synced_at: Mapped[object | None] = mapped_column(DateTime)
    sync_cursor: Mapped[dict] = mapped_column(JSON, default=dict)


class InboxMessage(Identity, Created, Base):
    __tablename__ = "inbox_messages"
    __table_args__ = (UniqueConstraint("user_id", "connection_id", "external_id"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[str | None] = mapped_column(ForeignKey("applications.id", ondelete="SET NULL"))
    connection_id: Mapped[str | None] = mapped_column(ForeignKey("mail_connections.id", ondelete="SET NULL"))
    external_id: Mapped[str | None] = mapped_column(String(500))
    sender: Mapped[str] = mapped_column(String(320))
    recipient: Mapped[str] = mapped_column(String(320))
    subject: Mapped[str] = mapped_column(String(500), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(30), default="primary")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    starred: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    received_at: Mapped[object] = mapped_column(DateTime, default=utcnow)


class MailDraft(Identity, Created, Updated, Base):
    __tablename__ = "mail_drafts"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[str | None] = mapped_column(ForeignKey("applications.id", ondelete="SET NULL"))
    connection_id: Mapped[str | None] = mapped_column(ForeignKey("mail_connections.id", ondelete="SET NULL"))
    recipient: Mapped[str] = mapped_column(String(320), default="")
    subject: Mapped[str] = mapped_column(String(500), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    attachment_ids: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(40), default="draft")
    send_key: Mapped[str | None] = mapped_column(String(200), unique=True)
    error: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[object | None] = mapped_column(DateTime)


class Notification(Identity, Created, Base):
    __tablename__ = "notifications"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[str | None] = mapped_column(ForeignKey("applications.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)


class SupportProblem(Identity, Created, Base):
    __tablename__ = "support_problems"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    description: Mapped[str] = mapped_column(Text)
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(30), default="open")


class RefreshSession(Identity, Created, Base):
    __tablename__ = "refresh_sessions"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[object] = mapped_column(DateTime)
    revoked_at: Mapped[object | None] = mapped_column(DateTime)
    assurance: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    security_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    authenticated_at: Mapped[datetime | None] = mapped_column(DateTime)


class AccountSettings(Updated, Base):
    __tablename__ = "account_settings"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    theme: Mapped[str] = mapped_column(String(20), default="paper", server_default="paper")
    text_size: Mapped[str] = mapped_column(String(20), default="normal", server_default="normal")
    auto_resume: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    theme_initialized: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")


class MfaFactor(Updated, Base):
    __tablename__ = "mfa_factors"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    secret_encrypted: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    setup_expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_counter: Mapped[int] = mapped_column(Integer, default=-1)
    recovery_hashes: Mapped[list] = mapped_column(JSON, default=list)
    failed_checks: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class AuthChallenge(Identity, Created, Base):
    __tablename__ = "auth_challenges"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    purpose: Mapped[str] = mapped_column(String(30))
    security_version: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime)
    attempts: Mapped[int] = mapped_column(Integer, default=0)


class ApplicationTask(Identity, Created, Updated, Base):
    __tablename__ = "application_tasks"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(200))
    due_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    remind_at: Mapped[datetime] = mapped_column(DateTime)
    notes: Mapped[str] = mapped_column(Text, default="")
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime)


class AccountDeletion(Updated, Base):
    __tablename__ = "account_deletions"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    status: Mapped[str] = mapped_column(String(30), default="pending")
    storage_keys: Mapped[list] = mapped_column(JSON, default=list)
    captured_email: Mapped[str | None] = mapped_column(String(320))
    error: Mapped[str | None] = mapped_column(String(300))
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class VerificationToken(Identity, Created, Base):
    __tablename__ = "verification_tokens"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    purpose: Mapped[str] = mapped_column(String(50))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[object] = mapped_column(DateTime)
    used_at: Mapped[object | None] = mapped_column(DateTime)
