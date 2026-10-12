from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import pytest
from sqlalchemy import select

from app.core.security import SecretBox
from app.core.storage import Storage
from app.core.time import utcnow
from app.domain.inbox import application_for_message
from app.models import (
    Application,
    Document,
    InboxMessage,
    Job,
    MailConnection,
    MailDraft,
    Notification,
    Resume,
    SupportProblem,
)
from app.services import mail


def message(db, user, **changes):
    row = InboxMessage(user_id=user.id, sender="hiring@example.com", recipient=user.email,
                       subject="Interview for Security Analyst", body="Please schedule your interview.",
                       category="interview", **changes)
    db.add(row)
    db.commit()
    return row


def draft(client, headers, **changes):
    payload = {"recipient": "recruiter@example.com", "subject": "Application follow-up", "body": "Thank you for considering my application."}
    payload.update(changes)
    result = client.post("/api/v1/inbox/drafts", headers=headers, json=payload)
    assert result.status_code == 201, result.text
    return result.json()


def connection(client, headers, **changes):
    payload = {"provider": "gmail", "email": "testmail@example.com", "password": "application-password"}
    payload.update(changes)
    result = client.post("/api/v1/inbox/connections", headers=headers, json=payload)
    assert result.status_code == 201, result.text
    return result.json()


def test_private_resources_require_authentication(client):
    for path in ("/inbox/messages", "/inbox/drafts", "/inbox/connections", "/notifications", "/support/problems", "/support/faq"):
        assert client.get("/api/v1" + path).status_code == 401


def test_messages_are_owned_filtered_and_archived(client, db, user, other_user, headers, other_headers):
    own = message(db, user)
    private = message(db, other_user)
    assert client.get(f"/api/v1/inbox/messages/{private.id}", headers=headers).status_code == 404
    assert client.patch(f"/api/v1/inbox/messages/{private.id}", headers=headers, json={"is_read": True}).status_code == 404
    result = client.get("/api/v1/inbox/messages?category=interview&search=Security&limit=1", headers=headers).json()
    assert result["total"] == 1 and result["items"][0]["id"] == own.id
    summary = client.get("/api/v1/inbox/summary", headers=headers).json()
    assert summary["total"] == summary["unread"] == 1 and summary["categories"]["interview"]["unread"] == 1
    assert client.get("/api/v1/inbox/messages?search=%25", headers=headers).json()["total"] == 0
    result = client.patch(f"/api/v1/inbox/messages/{own.id}", headers=headers, json={"is_read": True, "starred": True, "archived": True})
    assert result.status_code == 200 and result.json()["starred"]
    assert client.get("/api/v1/inbox/messages", headers=headers).json()["total"] == 0
    assert client.get("/api/v1/inbox/messages?archived=true", headers=headers).json()["total"] == 1
    assert client.get("/api/v1/inbox/summary", headers=headers).json()["total"] == 0
    assert client.get("/api/v1/inbox/messages?limit=101", headers=headers).status_code == 422


def test_connections_encrypt_credentials_allowlist_and_remove_secret(client, db, headers, other_headers, settings):
    created = connection(client, headers)
    stored = db.get(MailConnection, created["id"])
    assert "password" not in created and "secret_encrypted" not in created
    assert stored.secret_encrypted != "application-password"
    assert SecretBox().decrypt(stored.secret_encrypted) == "application-password"
    assert client.delete(f"/api/v1/inbox/connections/{created['id']}", headers=other_headers).status_code == 404
    invalid = client.post("/api/v1/inbox/connections", headers=headers, json={"provider": "gmail", "email": "second@example.com", "password": "secret", "smtp_host": "127.0.0.1"})
    assert invalid.status_code == 422
    settings.mail_allowed_hosts = []
    denied = client.post("/api/v1/inbox/connections", headers=headers, json={"provider": "gmail", "email": "second@example.com", "password": "secret"})
    assert denied.status_code == 422
    assert client.delete(f"/api/v1/inbox/connections/{created['id']}", headers=headers).status_code == 204
    db.refresh(stored)
    assert not stored.active and stored.secret_encrypted == ""


def test_demo_sync_never_connects(client, headers, monkeypatch):
    created = connection(client, headers)
    monkeypatch.setattr(mail, "sync_inbox", lambda **kwargs: pytest.fail("Demo must not contact a mailbox"))
    result = client.post(f"/api/v1/inbox/connections/{created['id']}/sync", headers=headers)
    assert result.status_code == 200 and result.json()["status"] == "demo_no_network"


def test_sync_is_deduplicated_and_creates_notifications(client, db, headers, user, settings, monkeypatch):
    created = connection(client, headers)
    settings.mail_mode = "smtp"
    fetched = mail.FetchedMessage(uid="17", external_id="<mail@example.com>", subject="Interview invitation", sender_email="recruiter@example.com", sender_name="Recruiter", recipient_email=user.email, body="Please choose an interview time.", received_at=datetime.now(timezone.utc), category="interview")
    calls = []

    def mocked_sync(**kwargs):
        calls.append(kwargs)
        return [fetched], {"last_uid": 17, "uidvalidity": "123"}

    monkeypatch.setattr(mail, "sync_inbox", mocked_sync)
    path = f"/api/v1/inbox/connections/{created['id']}/sync"
    assert client.post(path, headers=headers).json()["imported"] == 1
    assert client.post(path, headers=headers).json()["imported"] == 0
    assert calls[1]["after_uid"] == 17
    assert calls[0]["password"] == "application-password"
    messages = db.scalars(select(InboxMessage).where(InboxMessage.user_id == user.id)).all()
    assert len(messages) == 1 and messages[0].external_id == "123:17"
    assert len(db.scalars(select(Notification).where(Notification.user_id == user.id)).all()) == 1


def test_demo_send_is_explicit_captured_idempotent_and_locked(client, headers, other_headers, monkeypatch):
    created = draft(client, headers)
    monkeypatch.setattr(mail, "send_message", lambda **kwargs: pytest.fail("Demo must not send email"))
    path = f"/api/v1/inbox/drafts/{created['id']}/send"
    assert client.post(path, headers=other_headers | {"Idempotency-Key": "one"}).status_code == 404
    result = client.post(path, headers=headers | {"Idempotency-Key": "one"})
    assert result.status_code == 200 and result.json()["status"] == "captured" and result.json()["sent_at"] is None
    assert client.post(path, headers=headers | {"Idempotency-Key": "one"}).json() == result.json()
    assert client.post(path, headers=headers | {"Idempotency-Key": "two"}).status_code == 409
    assert client.patch(f"/api/v1/inbox/drafts/{created['id']}", headers=headers, json={"body": "Changed message"}).status_code == 409
    assert client.delete(f"/api/v1/inbox/drafts/{created['id']}", headers=headers).status_code == 409


def test_mail_send_key_cannot_be_reused_for_another_draft(client, headers):
    first = draft(client, headers)
    second = draft(client, headers)
    send_headers = headers | {"Idempotency-Key": "duplicate-key"}
    assert client.post(f"/api/v1/inbox/drafts/{first['id']}/send", headers=send_headers).status_code == 200
    conflict = client.post(f"/api/v1/inbox/drafts/{second['id']}/send", headers=send_headers)
    assert conflict.status_code == 409
    assert client.get(f"/api/v1/inbox/drafts/{second['id']}", headers=headers).json()["status"] == "draft"


def test_drafts_are_editable_only_before_send_and_headers_are_validated(client, headers, other_headers):
    created = draft(client, headers)
    path = f"/api/v1/inbox/drafts/{created['id']}"
    assert client.get(path, headers=other_headers).status_code == 404
    assert client.patch(path, headers=other_headers, json={"body": "Another message"}).status_code == 404
    assert client.patch(path, headers=headers, json={"subject": "Updated follow-up"}).json()["subject"] == "Updated follow-up"
    assert client.patch(path, headers=headers, json={"subject": "bad\r\nBcc: victim@example.com"}).status_code == 422
    assert client.post("/api/v1/inbox/drafts", headers=headers, json={"recipient": "not-an-email", "subject": "Test", "body": "Test"}).status_code == 422
    assert client.delete(path, headers=headers).status_code == 204


def test_attachments_are_owned_bounded_and_available_at_send(client, db, user, other_user, headers, settings):
    owned_doc = Document(user_id=user.id, filename="resume.txt", content_type="text/plain", storage_key="owned/resume.txt", size_bytes=6, sha256="a" * 64)
    private_doc = Document(user_id=other_user.id, filename="private.txt", content_type="text/plain", storage_key="private/resume.txt", size_bytes=7, sha256="b" * 64)
    db.add_all([owned_doc, private_doc])
    db.commit()
    base = {"recipient": "recruiter@example.com", "subject": "Application", "body": "Attached résumé"}
    assert client.post("/api/v1/inbox/drafts", headers=headers, json=base | {"attachment_ids": [private_doc.id]}).status_code == 404
    assert client.post("/api/v1/inbox/drafts", headers=headers, json=base | {"attachment_ids": [owned_doc.id, owned_doc.id]}).status_code == 422
    created = draft(client, headers, attachment_ids=[owned_doc.id])
    path = f"/api/v1/inbox/drafts/{created['id']}/send"
    assert client.post(path, headers=headers | {"Idempotency-Key": "missing-file"}).status_code == 404
    assert client.get(f"/api/v1/inbox/drafts/{created['id']}", headers=headers).json()["status"] == "draft"
    Storage().put(owned_doc.storage_key, b"resume", "text/plain")
    assert client.post(path, headers=headers | {"Idempotency-Key": "valid-file"}).json()["status"] == "captured"


def test_application_linking_never_reads_other_users_or_guesses_ambiguously(db, user, other_user):
    job = Job(title="Security Analyst", company="Example Security", attributes={"employer_domain": "example.com"})
    first_resume = Resume(user_id=user.id)
    other_resume = Resume(user_id=other_user.id)
    db.add_all([job, first_resume, other_resume])
    db.flush()
    own_application = Application(user_id=user.id, job_id=job.id, resume_id=first_resume.id)
    private_application = Application(user_id=other_user.id, job_id=job.id, resume_id=other_resume.id)
    db.add_all([own_application, private_application])
    db.commit()
    fetched = mail.FetchedMessage(uid="1", external_id="", subject="Interview with Example Security", sender_email="hiring@example.com", sender_name="Hiring", recipient_email=user.email, body="Invite", received_at=datetime.now(timezone.utc), category="interview")
    assert application_for_message(db, user.id, fetched) == own_application.id
    another_job = Job(title="Security Architect", company="Example Security", attributes={"employer_domain": "example.com"})
    db.add(another_job)
    db.flush()
    db.add(Application(user_id=user.id, job_id=another_job.id, resume_id=first_resume.id))
    db.commit()
    assert application_for_message(db, user.id, fetched) is None


@pytest.mark.parametrize("unknown,expected", [(False, "failed"), (True, "delivery_unknown")])
def test_smtp_error_is_safe_and_never_retried(client, headers, settings, monkeypatch, unknown, expected):
    conn = connection(client, headers)
    created = draft(client, headers, connection_id=conn["id"])
    settings.mail_mode = "smtp"
    calls = []

    def fail_send(**kwargs):
        calls.append(kwargs)
        raise mail.MailDeliveryError(delivery_unknown=unknown)

    monkeypatch.setattr(mail, "send_message", fail_send)
    path = f"/api/v1/inbox/drafts/{created['id']}/send"
    result = client.post(path, headers=headers | {"Idempotency-Key": "failure"})
    assert result.status_code == 200 and result.json()["status"] == expected
    assert "application-password" not in result.text
    assert client.post(path, headers=headers | {"Idempotency-Key": "failure"}).json()["status"] == expected
    assert client.post(path, headers=headers | {"Idempotency-Key": "retry"}).status_code == 409
    assert len(calls) == 1


def test_real_send_needs_own_connection_and_sets_timestamp(client, headers, other_headers, settings, monkeypatch):
    other_connection = connection(client, other_headers)
    result = client.post("/api/v1/inbox/drafts", headers=headers, json={"recipient": "recruiter@example.com", "subject": "Hello", "body": "Message", "connection_id": other_connection["id"]})
    assert result.status_code == 404
    created = draft(client, headers)
    settings.mail_mode = "smtp"
    path = f"/api/v1/inbox/drafts/{created['id']}/send"
    assert client.post(path, headers=headers | {"Idempotency-Key": "no-connection"}).status_code == 409
    conn = connection(client, headers)
    client.patch(f"/api/v1/inbox/drafts/{created['id']}", headers=headers, json={"connection_id": conn["id"]})
    monkeypatch.setattr(mail, "send_message", lambda **kwargs: "sent")
    result = client.post(path, headers=headers | {"Idempotency-Key": "with-connection"})
    assert result.json()["status"] == "sent" and result.json()["sent_at"] is not None


def test_interrupted_send_becomes_uncertain_without_network(client, db, user, headers):
    row = MailDraft(user_id=user.id, recipient="recruiter@example.com", subject="Follow-up", body="Message", status="sending", send_key="interrupted", updated_at=utcnow() - timedelta(minutes=10))
    db.add(row)
    db.commit()
    result = client.get(f"/api/v1/inbox/drafts/{row.id}", headers=headers)
    assert result.json()["status"] == "delivery_unknown" and result.json()["sent_at"] is None


def test_notifications_are_private_and_read_all_is_scoped(client, db, user, other_user, headers):
    first = Notification(user_id=user.id, kind="inbox", title="Interview", body="Employer replied")
    private = Notification(user_id=other_user.id, kind="inbox", title="Private", body="Private")
    db.add_all([first, private])
    db.commit()
    assert client.patch(f"/api/v1/notifications/{private.id}", headers=headers, json={"is_read": True}).status_code == 404
    assert client.get("/api/v1/notifications?is_read=false", headers=headers).json()["total"] == 1
    assert client.post("/api/v1/notifications/read-all", headers=headers).json()["updated"] == 1
    db.refresh(private)
    assert not private.is_read


def test_support_is_local_persisted_owned_and_validated(client, db, headers, other_headers):
    result = client.post("/api/v1/support/problems", headers=headers, json={"description": "Cannot open application details.", "context": {"page": "/applications", "error_code": "details_unavailable"}})
    assert result.status_code == 201
    identifier = result.json()["id"]
    assert db.get(SupportProblem, identifier).status == "open"
    assert client.get(f"/api/v1/support/problems/{identifier}", headers=other_headers).status_code == 404
    assert client.patch(f"/api/v1/support/problems/{identifier}", headers=headers, json={"status": "closed"}).json()["status"] == "closed"
    assert client.get("/api/v1/support/problems?status=closed", headers=headers).json()["total"] == 1
    assert client.post("/api/v1/support/problems", headers=headers, json={"description": "Valid description", "context": {"access_token": "must-not-save"}}).status_code == 422
    faq = client.get("/api/v1/support/faq?category=inbox", headers=headers).json()
    assert not faq["live_support_available"] and all(item["category"] == "inbox" for item in faq["items"])


@pytest.mark.parametrize("subject,expected", [("Verify your account", "verification"), ("Interview invitation", "interview"), ("Job offer", "offer"), ("We regret to inform you", "rejection"), ("Technical assessment", "assessment"), ("Welcome aboard", "onboarding"), ("Reminder: interview tomorrow", "reminder"), ("Application received", "confirmation"), ("Hello", "primary")])
def test_message_categories(subject, expected):
    assert mail.categorize_message(subject) == expected


def test_message_parser_returns_plain_text_and_never_scripts():
    email = EmailMessage()
    email["Subject"] = "Interview invitation"
    email["From"] = "Hiring Team <hiring@example.com>"
    email["To"] = "candidate@example.com"
    email["Date"] = "Sun, 11 Oct 2026 12:00:00 +0100"
    email.set_content("<p>Hello candidate</p><script>steal()</script><p>Interview invitation</p>", subtype="html")
    parsed = mail.parse_message(email.as_bytes(), "22")
    assert parsed.category == "interview" and parsed.sender_email == "hiring@example.com"
    assert "Hello candidate" in parsed.body and "steal" not in parsed.body and "<p>" not in parsed.body
    assert parsed.received_at.hour == 11
    with pytest.raises(ValueError):
        mail.parse_message(b"x" * (mail.MAX_MESSAGE_BYTES + 1), "23")


def test_smtp_uses_fixed_tls_host_and_never_allows_disabled_send(monkeypatch):
    calls = []

    class SMTP:
        def __init__(self, host, port, **kwargs):
            calls.append((host, port, kwargs))
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def login(self, username, password):
            calls.append((username, password))
        def send_message(self, message, **kwargs):
            calls.append(message)
            return {}

    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", SMTP)
    arguments = dict(provider="gmail", allowed_providers=["gmail"], username="candidate@example.com", password="secret", recipient="recruiter@example.com", subject="Follow-up", body="Hello", message_id="<test@local.cyberapply>")
    with pytest.raises(mail.MailConfigurationError):
        mail.send_message(**arguments, enabled=False)
    assert not calls
    assert mail.send_message(**arguments, enabled=True) == "sent"
    assert calls[0][0:2] == ("smtp.gmail.com", 465) and "context" in calls[0][2]


def test_imap_uidvalidity_reset_size_guard_and_readonly(monkeypatch):
    email = EmailMessage()
    email["Subject"] = "Application received"
    email["From"] = "hiring@example.com"
    email.set_content("Thank you for applying")
    raw = email.as_bytes()
    calls = []

    class IMAP:
        def __init__(self, host, port, **kwargs):
            assert (host, port) == ("imap.gmail.com", 993)
        def login(self, username, password):
            pass
        def select(self, name, readonly):
            assert name == "INBOX" and readonly is True
            return "OK", [b"2"]
        def response(self, name):
            return "UIDVALIDITY", [b"new-validity"]
        def uid(self, action, arg, value):
            calls.append((action, arg, value))
            if action == "search":
                assert value == "UID 1:*"
                return "OK", [b"1 2"]
            if value == "(RFC822.SIZE)":
                size = len(raw) if arg == "1" else mail.MAX_MESSAGE_BYTES + 1
                return "OK", [f"1 (RFC822.SIZE {size})".encode()]
            assert arg == "1" and value == "(BODY.PEEK[])"
            return "OK", [(b"header", raw), b")"]
        def logout(self):
            pass

    monkeypatch.setattr(mail.imaplib, "IMAP4_SSL", IMAP)
    fetched, cursor = mail.sync_inbox(provider="gmail", allowed_providers=["gmail"], username="candidate@example.com", password="secret", enabled=True, after_uid=100, uidvalidity="old-validity")
    assert len(fetched) == 1 and fetched[0].uid == "1"
    assert cursor == {"last_uid": 2, "uidvalidity": "new-validity"}
    assert not any(arg == "2" and value == "(BODY.PEEK[])" for _, arg, value in calls)
