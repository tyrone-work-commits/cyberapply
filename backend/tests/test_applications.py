import hashlib
import hmac
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app import workers
from app.core.db import Base
from app.core.time import utcnow
from app.models import (
    Application,
    ApplicationEvent,
    AutomationSettings,
    Job,
    Preferences,
    Profile,
    Resume,
    SavedJob,
    User,
)


def inputs(db, user, *, demo=True, required_fields=None):
    profile = db.get(Profile, user.id)
    profile.data = {"full_name": "Test Candidate", "email": user.email, "skills": ["siem", "incident response"], "certifications": []}
    profile.confirmed = True
    resume = Resume(user_id=user.id, title="Reviewed resume", extracted_text="Test Candidate\nSIEM and incident response", reviewed=True,
                    profile_data={"skills": ["siem", "incident response"]})
    job = Job(title="SOC Analyst", company="Fixture Cybersecurity", required_skills=["siem", "incident response"],
              is_demo=demo, connector_key="demo" if demo else "webhook", attributes={"required_fields": required_fields or ["full_name", "email"]})
    db.add_all([resume, job])
    db.commit()
    return job, resume


def create(client, headers, job, resume, **extra):
    return client.post("/api/v1/applications", headers=headers,
                       json={"job_id": job.id, "resume_id": resume.id, **extra})


def factory(db):
    return sessionmaker(bind=db.bind, expire_on_commit=False)


def test_review_lifecycle_is_queued_and_snapshot_is_immutable(client, db, user, headers):
    job, resume = inputs(db, user)
    response = create(client, headers, job, resume)
    assert response.status_code == 201
    app = response.json()
    assert app["status"] == "queued" and app["attempts"] == 0
    assert client.post(f"/api/v1/applications/{app['id']}/approve", headers=headers).status_code == 409
    original = resume.extracted_text
    resume.extracted_text = "Later resume revision"
    resume.version += 1
    db.commit()
    workers.run_worker_once(factory(db))
    detail = client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()
    assert detail["status"] == "needs_review"
    assert detail["resume_snapshot"]["text"] == original
    assert detail["answers"]["resume_text"] == original
    approval = client.post(f"/api/v1/applications/{app['id']}/approve", headers=headers,
                           json={"expected_version": detail["version"]})
    assert approval.status_code == 200 and approval.json()["status"] == "ready"
    assert approval.json()["confirmation_id"] is None
    workers.run_worker_once(factory(db))
    detail = client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()
    assert detail["status"] == "applied" and detail["confirmation_id"].startswith("demo-") and detail["is_demo"]
    assert detail["attempts"] == 1
    events = client.get(f"/api/v1/applications/{app['id']}/events", headers=headers).json()["items"]
    assert [e["event_type"] for e in events] == ["queued", "preparing", "needs_review", "approved", "submitting", "applied"]


def test_automatic_mode_requires_opt_in_and_pause_blocks_worker(client, db, user, headers):
    job, resume = inputs(db, user)
    settings = client.get("/api/v1/automation", headers=headers).json()
    assert settings["mode"] == "review"
    assert client.patch("/api/v1/automation", headers=headers, json={"mode": "automatic"}).status_code == 200
    app = create(client, headers, job, resume).json()
    assert app["mode"] == "automatic"
    workers.run_worker_once(factory(db), max_items=1)
    assert client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()["status"] == "ready"
    client.patch("/api/v1/automation", headers=headers, json={"paused": True})
    assert workers.run_worker_once(factory(db)) == 0
    assert client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()["confirmation_id"] is None
    client.patch("/api/v1/automation", headers=headers, json={"paused": False})
    workers.run_worker_once(factory(db))
    assert client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()["status"] == "applied"


def test_ownership_for_applications_resume_and_events(client, db, user, headers, other_user, other_headers):
    job, resume = inputs(db, user)
    app = create(client, headers, job, resume).json()
    assert create(client, other_headers, job, resume).status_code == 404
    assert client.get("/api/v1/applications", headers=other_headers).json()["items"] == []
    for suffix in ["", "/events"]:
        assert client.get(f"/api/v1/applications/{app['id']}{suffix}", headers=other_headers).status_code == 404
    for suffix in ["approve", "cancel", "retry", "reconcile"]:
        assert client.post(f"/api/v1/applications/{app['id']}/{suffix}", headers=other_headers).status_code == 404
    assert client.patch(f"/api/v1/applications/{app['id']}", headers=other_headers, json={"answers": {}}).status_code == 404


def test_duplicate_and_idempotency_conflict(client, db, user, headers):
    job, resume = inputs(db, user)
    first = create(client, headers, job, resume, idempotency_key="request-one").json()
    repeated = create(client, headers, job, resume, idempotency_key="request-one")
    assert repeated.status_code == 201 and repeated.json()["id"] == first["id"]
    assert create(client, headers, job, resume, idempotency_key="request-two").status_code == 409
    second_job, _ = inputs(db, user)
    conflict = create(client, headers, second_job, resume, idempotency_key="request-one")
    assert conflict.status_code == 409 and conflict.json()["detail"]["code"] == "idempotency_conflict"


def test_daily_quota_and_cancelled_reservation(client, db, user, headers):
    job, resume = inputs(db, user)
    client.patch("/api/v1/automation", headers=headers, json={"daily_limit": 1})
    first = create(client, headers, job, resume).json()
    second_job, _ = inputs(db, user)
    assert create(client, headers, second_job, resume).status_code == 429
    assert client.get("/api/v1/automation", headers=headers).json()["remaining_today"] == 0
    assert client.post(f"/api/v1/applications/{first['id']}/cancel", headers=headers).status_code == 200
    assert create(client, headers, second_job, resume).status_code == 201


def test_old_reservations_cannot_exceed_new_day_limit(client, db, user, headers):
    job, resume = inputs(db, user)
    first = create(client, headers, job, resume, mode="automatic").json()
    second_job, _ = inputs(db, user)
    second = create(client, headers, second_job, resume, mode="automatic").json()
    db.expire_all()
    for identifier in [first["id"], second["id"]]:
        row = db.get(Application, identifier)
        row.created_at = utcnow() - timedelta(days=1)
    config = db.get(AutomationSettings, user.id)
    config.daily_limit = 1
    db.commit()
    workers.run_worker_once(factory(db))
    db.expire_all()
    states = [db.get(Application, identifier).status for identifier in [first["id"], second["id"]]]
    assert states.count("applied") == 1 and states.count("ready") == 1


def test_missing_questions_require_review_and_stale_edits_are_rejected(client, db, user, headers):
    job, resume = inputs(db, user, required_fields=["full_name", "email", "custom_question"])
    app = create(client, headers, job, resume, mode="automatic").json()
    workers.run_worker_once(factory(db))
    detail = client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()
    assert detail["status"] == "needs_attention" and "custom_question" in detail["missing_fields"]
    answer = {**detail["answers"], "custom_question": "My reviewed answer"}
    assert client.patch(f"/api/v1/applications/{app['id']}", headers=headers,
                        json={"answers": answer, "expected_version": detail["version"] - 1}).status_code == 409
    updated = client.patch(f"/api/v1/applications/{app['id']}", headers=headers,
                           json={"answers": answer, "expected_version": detail["version"]}).json()
    assert updated["status"] == "needs_review"
    workers.run_worker_once(factory(db))
    assert client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()["confirmation_id"] is None


def test_unreviewed_profile_and_resume_block_preparation(client, db, user, headers):
    job, resume = inputs(db, user)
    resume.reviewed = False
    db.commit()
    assert create(client, headers, job, resume).status_code == 409
    resume.reviewed = True
    db.get(Profile, user.id).confirmed = False
    db.commit()
    assert create(client, headers, job, resume).status_code == 409


def test_uncertain_submission_cannot_blindly_retry_and_reconciliation_never_submits(client, db, user, headers, monkeypatch):
    job, resume = inputs(db, user)
    app = create(client, headers, job, resume, mode="automatic").json()
    calls = {"submit": 0, "reconcile": 0}
    class AmbiguousConnector:
        def submit(self, application, job):
            calls["submit"] += 1
            raise workers.UncertainSubmission("Timeout after the employer may have accepted")
        def reconcile(self, application, job):
            calls["reconcile"] += 1
            return workers.SubmissionConfirmation("demo-recovered-receipt", is_demo=True)
    monkeypatch.setattr(workers, "connector_for", lambda *_: AmbiguousConnector())
    workers.run_worker_once(factory(db))
    assert client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()["status"] == "uncertain"
    assert client.post(f"/api/v1/applications/{app['id']}/retry", headers=headers).status_code == 409
    assert workers.run_worker_once(factory(db)) == 0
    assert client.post(f"/api/v1/applications/{app['id']}/reconcile", headers=headers).status_code == 200
    workers.run_worker_once(factory(db))
    assert calls == {"submit": 1, "reconcile": 1}
    assert client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()["status"] == "applied"


def test_expired_submission_lease_becomes_uncertain_without_a_resend(client, db, user, headers, monkeypatch):
    job, resume = inputs(db, user)
    app = create(client, headers, job, resume).json()
    db.expire_all()
    row = db.get(Application, app["id"])
    row.status = "submitting"
    row.claim_token = "old-worker"
    row.claim_until = utcnow() - timedelta(seconds=1)
    row.submission_started_at = utcnow()
    db.commit()
    monkeypatch.setattr(workers, "connector_for", lambda *_: pytest.fail("An expired submission must not be resent"))
    workers.run_worker_once(factory(db))
    detail = client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()
    assert detail["status"] == "uncertain" and detail["confirmation_id"] is None


def test_applied_state_requires_a_nonempty_confirmation(client, db, user, headers, monkeypatch):
    job, resume = inputs(db, user)
    app = create(client, headers, job, resume, mode="automatic").json()
    class InvalidReceipt:
        def submit(self, *_):
            return workers.SubmissionConfirmation("", is_demo=True)
    monkeypatch.setattr(workers, "connector_for", lambda *_: InvalidReceipt())
    workers.run_worker_once(factory(db))
    detail = client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()
    assert detail["status"] == "uncertain" and detail["confirmation_id"] is None


def test_worker_claim_is_exclusive(client, db, user, headers):
    job, resume = inputs(db, user)
    create(client, headers, job, resume)
    first = workers.claim_next(factory(db))
    assert first is not None
    assert workers.claim_next(factory(db)) is None


def test_paused_queue_does_not_starve_another_user(client, db, user, other_user, other_headers):
    _, resume = inputs(db, user)
    db.get(AutomationSettings, user.id).paused = True
    older = utcnow() - timedelta(days=1)
    for _ in range(55):
        job = Job(title="SOC Analyst", company="Paused fixture")
        db.add(job)
        db.flush()
        db.add(Application(user_id=user.id, job_id=job.id, resume_id=resume.id,
                           idempotency_key=str(uuid4()), created_at=older, updated_at=older))
    db.commit()
    job, resume = inputs(db, other_user)
    app = create(client, other_headers, job, resume).json()
    assert workers.run_worker_once(factory(db), max_items=1) == 1
    detail = client.get(f"/api/v1/applications/{app['id']}", headers=other_headers).json()
    assert detail["status"] == "needs_review"


def test_external_submission_disabled_by_default(client, db, user, headers):
    job, resume = inputs(db, user, demo=False)
    app = create(client, headers, job, resume, mode="automatic").json()
    workers.run_worker_once(factory(db))
    detail = client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()
    assert detail["status"] == "needs_attention" and detail["error_code"] == "connector_unavailable"
    assert detail["attempts"] == 0 and detail["confirmation_id"] is None
    assert client.get("/api/v1/integrations", headers=headers).json()["universal_ats_support"] is False


def test_automatic_mode_respects_explicit_preferences_and_unknown_salary(client, db, user, headers):
    job, resume = inputs(db, user)
    prefs = db.get(Preferences, user.id)
    prefs.data = {"roles": ["Cloud Security Architect"]}
    db.commit()
    response = create(client, headers, job, resume, mode="automatic")
    assert response.status_code == 409 and response.json()["detail"]["code"] == "automatic_preferences_mismatch"
    prefs.data = {"roles": ["SOC Analyst"], "min_salary": 100000, "currency": "USD"}
    db.commit()
    response = create(client, headers, job, resume, mode="automatic")
    assert response.status_code == 201
    workers.run_worker_once(factory(db))
    detail = client.get(f"/api/v1/applications/{response.json()['id']}", headers=headers).json()
    assert detail["status"] == "needs_attention" and detail["error_code"] == "preferences_attention"
    assert detail["confirmation_id"] is None


def test_unverified_account_cannot_submit_external_forms(client, db, user, headers, monkeypatch):
    job, resume = inputs(db, user, demo=False)
    user.email_verified = False
    db.commit()
    app = create(client, headers, job, resume, mode="automatic").json()
    class NoSubmission:
        def submit(self, *_):
            pytest.fail("An unverified account must not submit externally")
    monkeypatch.setattr(workers, "connector_for", lambda *_: NoSubmission())
    workers.run_worker_once(factory(db))
    detail = client.get(f"/api/v1/applications/{app['id']}", headers=headers).json()
    assert detail["status"] == "needs_attention" and detail["error_code"] == "email_verification_required"


def test_database_prevents_concurrent_duplicate_applications(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'concurrent.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions() as db:
        user = User(email="concurrent@example.com")
        db.add(user)
        db.flush()
        job = Job(title="Security Engineer", company="Fixture")
        resume = Resume(user_id=user.id, title="Resume")
        db.add_all([job, resume])
        db.commit()
        ids = user.id, job.id, resume.id
    def insert(_):
        with sessions() as db:
            db.add(Application(user_id=ids[0], job_id=ids[1], resume_id=ids[2], idempotency_key=str(uuid4())))
            try:
                db.commit()
                return "created"
            except IntegrityError:
                db.rollback()
                return "duplicate"
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(insert, [1, 2])) == ["created", "duplicate"]
    engine.dispose()


def webhook_objects(settings):
    settings.allow_external_submissions = True
    settings.webhook_connector_url = "https://employer.example.test/applications"
    settings.webhook_connector_secret = "fixture-signing-secret"
    settings.connector_allowed_hosts = ["employer.example.test"]
    application = SimpleNamespace(id="fixture-application", idempotency_key="fixture-request", answers={"full_name": "Candidate"},
                                  resume_snapshot={"text": "Reviewed resume"}, cover_letter="")
    job = SimpleNamespace(id="fixture-job", source_id="fixture-role", title="Security Engineer", company="Fixture")
    return application, job


def test_webhook_requires_signed_matching_receipt(settings):
    application, job = webhook_objects(settings)
    operations = []
    def handle(request):
        payload = json.loads(request.content)
        operations.append(payload["operation"])
        signature = "sha256=" + hmac.new(settings.webhook_connector_secret.encode(), request.content, hashlib.sha256).hexdigest()
        assert request.headers["X-JobApp-Signature"] == signature
        assert request.headers["Idempotency-Key"] == application.idempotency_key
        body = json.dumps({"application_id": application.id, "status": "confirmed", "confirmation_id": "receipt-123"}).encode()
        signed = "sha256=" + hmac.new(settings.webhook_connector_secret.encode(), body, hashlib.sha256).hexdigest()
        return httpx.Response(200, content=body, headers={"X-JobApp-Signature": signed})
    connector = workers.SignedWebhookConnector(settings, lambda **kw: httpx.Client(transport=httpx.MockTransport(handle), **kw))
    assert connector.submit(application, job).confirmation_id == "receipt-123"
    assert connector.reconcile(application, job).confirmation_id == "receipt-123"
    assert operations == ["submit", "status"]


def test_webhook_redirect_and_unsigned_success_are_uncertain(settings):
    application, job = webhook_objects(settings)
    for response in [httpx.Response(302, headers={"Location": "https://untrusted.example/apply"}),
                     httpx.Response(200, json={"status": "confirmed", "application_id": application.id, "confirmation_id": "untrusted"})]:
        requests = []
        def handle(request, _requests=requests, _response=response):
            _requests.append(request.url)
            return _response
        connector = workers.SignedWebhookConnector(settings, lambda **kw: httpx.Client(transport=httpx.MockTransport(handle), **kw))
        with pytest.raises(workers.UncertainSubmission):
            connector.submit(application, job)
        assert len(requests) == 1
    settings.connector_allowed_hosts = []
    with pytest.raises(workers.ConfirmedFailure):
        workers.SignedWebhookConnector(settings)


def test_manual_outcomes_preserve_confirmed_submission_and_summary_is_owned(client, db, user, headers, other_headers):
    job, resume = inputs(db, user)
    app = create(client, headers, job, resume, mode="automatic").json()
    path = f"/api/v1/applications/{app['id']}/outcome"
    assert client.patch(path, headers=headers, json={"outcome": "interview"}).status_code == 409
    workers.run_worker_once(factory(db))
    updated = client.patch(path, headers=headers, json={"outcome": "interview"})
    assert updated.status_code == 200
    assert updated.json()["status"] == "applied" and updated.json()["outcome"] == "interview"
    summary = client.get("/api/v1/applications/summary", headers=headers)
    assert summary.status_code == 200
    assert summary.json()["by_status"]["applied"] == 1 and summary.json()["by_outcome"]["interview"] == 1
    assert summary.json()["unread_notifications"] >= 1
    assert client.get("/api/v1/applications/summary", headers=other_headers).json()["total"] == 0
    assert client.patch(path, headers=other_headers, json={"outcome": "offer"}).status_code == 404
    assert client.patch(path, headers=headers, json={"outcome": "invented"}).status_code == 422
    assert len(client.get("/api/v1/applications?outcome=interview", headers=headers).json()["items"]) == 1
    events = client.get(f"/api/v1/applications/{app['id']}/events", headers=headers).json()["items"]
    assert [item["sequence"] for item in events] == list(range(1, len(events) + 1))
    assert events[-1]["data"]["source"] == "user"


def automatic_setup(db, user, **job_options):
    job, resume = inputs(db, user, **job_options)
    resume.is_main = True
    settings = db.get(AutomationSettings, user.id)
    settings.mode = "automatic"
    db.get(Preferences, user.id).data = {"roles": ["SOC Analyst"]}
    db.commit()
    return job, resume


def test_worker_discovers_opted_in_job_without_manual_application(client, db, user, headers, monkeypatch):
    job, resume = automatic_setup(db, user)
    def forbidden_network(*_args, **_kwargs):
        pytest.fail("Automatic demo discovery must not make external requests")
    monkeypatch.setattr(httpx, "Client", forbidden_network)
    assert workers.run_worker_once(factory(db)) == 2
    apps = client.get("/api/v1/applications", headers=headers).json()["items"]
    assert len(apps) == 1 and apps[0]["job_id"] == job.id and apps[0]["status"] == "applied"
    detail = client.get(f"/api/v1/applications/{apps[0]['id']}", headers=headers).json()
    assert detail["resume_snapshot"]["resume_id"] == resume.id
    assert detail["resume_snapshot"]["text"] == resume.extracted_text and detail["mode"] == "automatic"
    assert detail["confirmation_id"].startswith("demo-")
    events = client.get(f"/api/v1/applications/{apps[0]['id']}/events", headers=headers).json()["items"]
    assert events[0]["data"]["source"] == "automatic_discovery"
    assert workers.run_worker_once(factory(db)) == 0
    assert client.get("/api/v1/applications", headers=headers).json()["total"] == 1


@pytest.mark.parametrize("gate", ["review", "paused", "profile", "resume", "main", "roles", "inactive_user"])
def test_automatic_discovery_requires_complete_explicit_setup(db, user, gate):
    _, resume = automatic_setup(db, user)
    settings = db.get(AutomationSettings, user.id)
    if gate == "review":
        settings.mode = "review"
    elif gate == "paused":
        settings.paused = True
    elif gate == "profile":
        db.get(Profile, user.id).confirmed = False
    elif gate == "resume":
        resume.reviewed = False
    elif gate == "main":
        resume.is_main = False
    elif gate == "roles":
        db.get(Preferences, user.id).data = {"min_salary": 100000}
    else:
        user.active = False
    db.commit()
    assert workers.run_worker_once(factory(db)) == 0
    assert db.scalar(select(func.count()).select_from(Application)) == 0


@pytest.mark.parametrize("preferences", [
    {"roles": ["Cloud Security Architect"]},
    {"roles": ["SOC Analyst"], "min_salary": 100000, "currency": "USD"},
    {"roles": ["SOC Analyst"], "countries": ["US"]},
    {"roles": ["SOC Analyst"], "excluded_companies": ["Fixture Cybersecurity"]},
])
def test_discovery_rejects_unmatched_or_unknown_strict_preferences(db, user, preferences):
    automatic_setup(db, user)
    db.get(Preferences, user.id).data = preferences
    db.commit()
    assert workers.run_worker_once(factory(db)) == 0
    assert db.scalar(select(func.count()).select_from(Application)) == 0


def test_discovery_skips_passed_duplicate_private_and_unsupported_jobs(client, db, user, headers, other_user):
    duplicate, resume = automatic_setup(db, user)
    original = create(client, headers, duplicate, resume, mode="review").json()
    client.post(f"/api/v1/applications/{original['id']}/cancel", headers=headers)
    passed, _ = inputs(db, user)
    private, _ = inputs(db, other_user)
    private.owner_id = other_user.id
    unsupported, _ = inputs(db, user)
    unsupported.connector_key = "unsupported"
    expired, _ = inputs(db, user)
    expired.expires_at = utcnow() - timedelta(hours=1)
    inactive, _ = inputs(db, user)
    inactive.active = False
    eligible, _ = inputs(db, user)
    eligible.owner_id = user.id
    db.add(SavedJob(user_id=user.id, job_id=passed.id, decision="passed"))
    db.commit()
    workers.run_worker_once(factory(db))
    apps = client.get("/api/v1/applications", headers=headers).json()["items"]
    assert {app["job_id"] for app in apps} == {duplicate.id, eligible.id}
    assert next(app for app in apps if app["job_id"] == duplicate.id)["status"] == "cancelled"
    submitted = next(app for app in apps if app["job_id"] == eligible.id)
    assert submitted["status"] == "applied" and submitted["resume_id"] == resume.id


def test_discovery_score_order_and_quota_choose_best_candidate(db, user):
    strongest, _ = automatic_setup(db, user)
    weakest, _ = inputs(db, user)
    weakest.required_skills = ["unmatched proprietary tool"]
    weakest.updated_at = utcnow() - timedelta(hours=1)
    settings = db.get(AutomationSettings, user.id)
    settings.daily_limit = 1
    settings.min_match_score = 0
    db.commit()
    workers.run_worker_once(factory(db))
    db.expire_all()
    apps = db.scalars(select(Application).where(Application.user_id == user.id)).all()
    assert len(apps) == 1 and apps[0].job_id == strongest.id and apps[0].status == "applied"
    assert workers.run_worker_once(factory(db)) == 0
    assert db.scalar(select(func.count()).select_from(Application)) == 1


def test_discovery_missing_required_answer_needs_attention_without_inventing(db, user):
    job, _ = automatic_setup(db, user, required_fields=["full_name", "email", "why_this_company"])
    assert workers.run_worker_once(factory(db)) == 1
    app = db.scalar(select(Application).where(Application.job_id == job.id))
    assert app.status == "needs_attention" and app.missing_fields == ["why_this_company"]
    assert "why_this_company" not in app.answers and app.attempts == 0 and app.confirmation_id is None


def test_discovery_users_and_job_windows_advance_durably(db, user, other_user):
    user_job, user_resume = automatic_setup(db, user)
    user_job.owner_id = user.id
    other_job, other_resume = automatic_setup(db, other_user)
    other_job.owner_id = other_user.id
    unmatched = Job(owner_id=user.id, title="Cloud Security Architect", company="Fixture", is_demo=True,
                    connector_key="demo", updated_at=utcnow() - timedelta(days=1))
    db.add(unmatched)
    db.get(AutomationSettings, user.id).discovery_checked_at = utcnow() - timedelta(hours=2)
    db.get(AutomationSettings, other_user.id).discovery_checked_at = utcnow() - timedelta(hours=1)
    db.commit()
    sessions = factory(db)
    assert workers.discover_automatic_applications(sessions, max_users=1, max_jobs_per_user=1, max_created=1) == 0
    db.expire_all()
    assert db.get(AutomationSettings, user.id).discovery_cursor["job_id"] == unmatched.id
    assert workers.discover_automatic_applications(sessions, max_users=1, max_jobs_per_user=1, max_created=1) == 1
    assert workers.discover_automatic_applications(sessions, max_users=1, max_jobs_per_user=1, max_created=1) == 1
    apps = db.scalars(select(Application)).all()
    assert {(app.user_id, app.job_id, app.resume_id) for app in apps} == {
        (user.id, user_job.id, user_resume.id), (other_user.id, other_job.id, other_resume.id)}


def test_discovery_does_not_queue_unconfigured_external_connectors(db, user, settings, monkeypatch):
    job, _ = automatic_setup(db, user, demo=False)
    def forbidden_network(*_args, **_kwargs):
        pytest.fail("Configuration checks must not contact an employer")
    monkeypatch.setattr(httpx, "Client", forbidden_network)
    assert workers.run_worker_once(factory(db)) == 0
    assert db.scalar(select(func.count()).select_from(Application)) == 0
    settings.allow_external_submissions = True
    settings.webhook_connector_url = "https://employer.example.test/applications"
    settings.webhook_connector_secret = "fixture-secret"
    settings.connector_allowed_hosts = ["employer.example.test"]
    user.email_verified = False
    db.commit()
    assert workers.discover_automatic_applications(factory(db)) == 0
    user.email_verified = True
    job.connector_key = "browser_form"
    db.commit()
    assert workers.discover_automatic_applications(factory(db)) == 0


def test_worker_bootstrap_runs_versioned_migrations_before_drain(monkeypatch, capsys):
    actions = []
    monkeypatch.setattr("sys.argv", ["worker", "--once", "--max-items", "8"])
    monkeypatch.setattr(workers, "migrate_db", lambda: actions.append("migrate"))
    def drain(**kwargs):
        actions.append(("drain", kwargs["max_items"]))
        return 0
    monkeypatch.setattr(workers, "run_worker_once", drain)
    workers.main()
    assert actions == ["migrate", ("drain", 8)]
    assert json.loads(capsys.readouterr().out) == {"processed": 0}


def test_quota_filling_after_claim_does_not_repeat_wait_and_capacity_resumes(client, db, user, headers):
    job, resume = inputs(db, user)
    original = create(client, headers, job, resume, mode="automatic").json()
    sessions = factory(db)
    assert workers.run_worker_once(sessions, max_items=1) == 1
    db.expire_all()
    old = db.get(Application, original["id"])
    assert old.status == "ready"
    old.created_at = utcnow() - timedelta(days=1)
    db.get(AutomationSettings, user.id).daily_limit = 1
    db.commit()
    claim = workers.claim_next(sessions)
    assert claim is not None and claim[0] == old.id
    # Another reservation fills quota after the old application was claimed.
    reserved_job, _ = inputs(db, user)
    assert create(client, headers, reserved_job, resume, mode="review").status_code == 201
    workers.process_application(*claim, session_factory=sessions)
    waits = select(func.count()).select_from(ApplicationEvent).where(
        ApplicationEvent.application_id == old.id, ApplicationEvent.event_type == "daily_limit_wait")
    assert db.scalar(waits) == 1
    assert workers.run_worker_once(sessions) == 1  # Prepare the new review reservation once.
    assert workers.run_worker_once(sessions) == 0
    assert workers.run_worker_once(sessions) == 0
    assert db.scalar(waits) == 1
    db.expire_all()
    assert db.get(Application, old.id).status == "ready"
    db.get(AutomationSettings, user.id).daily_limit = 2
    db.commit()
    assert workers.run_worker_once(sessions) == 1
    db.expire_all()
    assert db.get(Application, old.id).status == "applied"
    assert db.scalar(waits) == 1


@pytest.mark.parametrize("stage", ["queued", "ready"])
def test_passing_discovered_job_cancels_before_submit(db, user, stage):
    job, _ = automatic_setup(db, user)
    sessions = factory(db)
    assert workers.discover_automatic_applications(sessions) == 1
    if stage == "ready":
        assert workers.run_worker_once(sessions, max_items=1) == 1
    db.add(SavedJob(user_id=user.id, job_id=job.id, decision="passed"))
    db.commit()
    assert workers.run_worker_once(sessions) == 1
    app = db.scalar(select(Application).where(Application.job_id == job.id))
    assert app.status == "cancelled" and app.attempts == 0 and app.confirmation_id is None
    assert workers.run_worker_once(sessions) == 0


@pytest.mark.parametrize("stage", ["queued", "ready"])
@pytest.mark.parametrize("change", ["review", "roles_cleared"])
def test_discovered_app_requires_review_after_automatic_intent_changes(db, user, stage, change):
    job, _ = automatic_setup(db, user)
    sessions = factory(db)
    assert workers.discover_automatic_applications(sessions) == 1
    if stage == "ready":
        assert workers.run_worker_once(sessions, max_items=1) == 1
    if change == "review":
        db.get(AutomationSettings, user.id).mode = "review"
    else:
        db.get(Preferences, user.id).data = {"roles": []}
    db.commit()
    assert workers.run_worker_once(sessions) == 1
    app = db.scalar(select(Application).where(Application.job_id == job.id))
    assert app.status == "needs_review" and app.mode == "review"
    assert app.attempts == 0 and app.confirmation_id is None
    assert workers.run_worker_once(sessions) == 0


def test_explicit_manual_automatic_request_keeps_per_application_intent(client, db, user, headers):
    job, resume = automatic_setup(db, user)
    created = create(client, headers, job, resume, mode="automatic").json()
    db.get(AutomationSettings, user.id).mode = "review"
    db.get(Preferences, user.id).data = {"roles": []}
    db.add(SavedJob(user_id=user.id, job_id=job.id, decision="passed"))
    db.commit()
    workers.run_worker_once(factory(db))
    detail = client.get(f"/api/v1/applications/{created['id']}", headers=headers).json()
    assert detail["mode"] == "automatic" and detail["status"] == "applied"
    assert detail["attempts"] == 1 and detail["confirmation_id"].startswith("demo-")


def test_removed_job_connector_blocks_stale_pending_application(client, db, user, headers):
    job, resume = inputs(db, user)
    created = create(client, headers, job, resume, mode="automatic").json()
    sessions = factory(db)
    assert workers.run_worker_once(sessions, max_items=1) == 1
    original_snapshot = client.get(f"/api/v1/applications/{created['id']}", headers=headers).json()["resume_snapshot"]
    job.connector_key = "unsupported"
    db.commit()
    assert workers.run_worker_once(sessions) == 1
    detail = client.get(f"/api/v1/applications/{created['id']}", headers=headers).json()
    assert detail["status"] == "needs_attention" and detail["error_code"] == "connector_unavailable"
    assert detail["connector_key"] == "demo" and detail["resume_snapshot"] == original_snapshot
    assert detail["attempts"] == 0 and detail["confirmation_id"] is None


@pytest.mark.parametrize("operation", ["submit", "reconcile"])
def test_connector_changed_at_post_commit_refresh_never_calls_stale_adapter(client, db, user, headers, monkeypatch, operation):
    job, resume = inputs(db, user)
    created = create(client, headers, job, resume, mode="automatic").json()
    sessions = factory(db)
    assert workers.run_worker_once(sessions, max_items=1) == 1
    if operation == "reconcile":
        app = db.get(Application, created["id"])
        app.status = "uncertain"
        app.error_code = "reconciliation_requested"
        db.commit()
    original_refresh = Session.refresh
    changes = []
    adapter_calls = []
    def refresh_with_admin_change(session, instance, *args, **kwargs):
        if isinstance(instance, Job) and instance.id == job.id and not changes:
            with sessions() as admin:
                changed_job = admin.get(Job, job.id)
                changed_job.connector_key = "unsupported"
                admin.commit()
            changes.append(job.id)
        return original_refresh(session, instance, *args, **kwargs)
    def forbidden_adapter(*_args, **_kwargs):
        adapter_calls.append(operation)
        pytest.fail("A removed connector must not receive an adapter request")
    monkeypatch.setattr(Session, "refresh", refresh_with_admin_change)
    monkeypatch.setattr(workers.DemoEmployerFixture, operation, forbidden_adapter)
    assert workers.run_worker_once(sessions) == 1
    detail = client.get(f"/api/v1/applications/{created['id']}", headers=headers).json()
    assert changes == [job.id] and adapter_calls == []
    assert detail["status"] == ("uncertain" if operation == "reconcile" else "needs_attention")
    assert detail["error_code"] == "connector_unavailable" and detail["confirmation_id"] is None
    assert detail["connector_key"] == "demo" and detail["resume_snapshot"]["resume_id"] == resume.id
