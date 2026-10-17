import io
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from uuid import uuid4

import httpx
import jwt
import pyotp
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from test_applications import create, factory, inputs

from app import workers
from app.core.db import Base, get_db, make_engine
from app.core.operations import live_io
from app.core.security import SecretBox, digest, ensure_user_records, issue_access, password_hash
from app.core.storage import Storage
from app.core.time import utcnow
from app.domain.account import cleanup_pending
from app.domain.mfa import verify_factor
from app.models import (
    AccountDeletion,
    AccountSettings,
    Application,
    AuthChallenge,
    AutomationSettings,
    Document,
    Job,
    MailDraft,
    MfaFactor,
    Notification,
    Preferences,
    Profile,
    Resume,
    User,
    VerificationToken,
)

PASSWORD = "Strong-test-password-2026"


def test_upload_and_erasure_serialize_on_active_account(settings, tmp_path, monkeypatch):
    import app.core.db as db_module
    from app.main import create_app
    engine = make_engine("sqlite:///" + (tmp_path / "upload-race.sqlite").as_posix())
    Base.metadata.create_all(engine)
    monkeypatch.setattr(db_module, "engine", engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions() as db:
        owner = User(email="upload-race@example.test", password_hash=password_hash.hash(PASSWORD), email_verified=True)
        db.add(owner)
        ensure_user_records(db, owner)
        db.commit()
        user_id, token = owner.id, issue_access(owner)
    app = create_app()
    def session_override():
        with sessions() as db:
            yield db
    app.dependency_overrides[get_db] = session_override
    stored, release, deleting = Event(), Event(), Event()
    original = Storage.put
    def delayed_put(storage, key, content, content_type):
        original(storage, key, content, content_type)
        stored.set()
        assert release.wait(10)
    monkeypatch.setattr(Storage, "put", delayed_put)
    headers = {"Authorization": "Bearer " + token}
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=2) as pool:
        upload = pool.submit(lambda: client.post("/api/v1/resumes/upload", headers=headers,
            files={"file": ("qa.txt", b"Upload QA\nSkills: SIEM", "text/plain")}))
        assert stored.wait(10)
        def erase():
            deleting.set()
            return client.request("DELETE", "/api/v1/account", headers=headers,
                json={"password": PASSWORD, "confirmation": "DELETE MY ACCOUNT"})
        deletion = pool.submit(erase)
        assert deleting.wait(5) and not deletion.done()
        release.set()
        assert upload.result(timeout=15).status_code == 201
        response = deletion.result(timeout=15)
        assert response.json()["status"] == "complete", response.text
    with sessions() as db:
        assert not db.get(User, user_id).active
        assert not db.scalar(select(Document).where(Document.user_id == user_id))
        assert not db.scalar(select(Resume).where(Resume.user_id == user_id))
    assert not list(settings.storage_dir.rglob("*.txt"))
    engine.dispose()


def test_provider_sensitive_actions_require_fresh_authentication(client, settings, user, monkeypatch):
    settings.auth_mode, settings.supabase_url = "supabase", "https://provider.example"
    settings.supabase_jwt_secret = "test-provider-signing-secret-with-32-characters"
    monkeypatch.setattr("httpx.get", lambda *a, **k: httpx.Response(200, json={"id": user.id, "factors": []}))
    sent = []
    monkeypatch.setattr("app.domain.auth.httpx.request", lambda method, url, **kw: (sent.append(method) or httpx.Response(200, json={}, request=httpx.Request(method, url))))
    now = int(utcnow().timestamp())
    # utcnow is naive UTC; use the signed claim's UTC epoch explicitly.
    from datetime import timezone
    now = int(utcnow().replace(tzinfo=timezone.utc).timestamp())
    claims = {"sub":user.id, "email":user.email, "aud":"authenticated", "role":"authenticated",
        "iss":settings.supabase_url+"/auth/v1", "iat":now, "exp":now+1800, "aal":"aal2", "amr":[{"method":"password", "timestamp":now-900}]}
    def headers():
        return {"Authorization":"Bearer "+jwt.encode(claims,settings.supabase_jwt_secret,algorithm="HS256")}
    result = client.put("/api/v1/auth/password", headers=headers(), json={"password":PASSWORD})
    assert result.status_code == 401 and not sent
    result = client.delete(f"/api/v1/auth/mfa/provider/factors/{uuid4()}", headers=headers())
    assert result.status_code == 401 and not sent
    claims["amr"][0]["timestamp"] = now
    assert client.put("/api/v1/auth/password", headers=headers(), json={"password":PASSWORD}).status_code == 200
    assert sent == ["PUT"]


def test_failed_document_delete_keeps_key_for_account_erasure(client, db, user, headers, monkeypatch):
    storage = Storage()
    key = "qa/delete-retry.txt"
    storage.put(key, b"private file", "text/plain")
    document = Document(user_id=user.id, kind="other", filename="private.txt", content_type="text/plain",
        storage_key=key, size_bytes=12, sha256="a" * 64)
    db.add(document)
    db.commit()
    original = Storage.delete
    monkeypatch.setattr(Storage, "delete", lambda *_: (_ for _ in ()).throw(OSError("storage down")))
    assert client.delete(f"/api/v1/documents/{document.id}", headers=headers).status_code == 503
    db.expire_all()
    assert db.get(Document, document.id).storage_key == key
    monkeypatch.setattr(Storage, "delete", original)
    response = client.request("DELETE", "/api/v1/account", headers=headers,
        json={"password": PASSWORD, "confirmation": "DELETE MY ACCOUNT"})
    assert response.json()["status"] == "complete", response.text
    assert not storage._path(key).exists()


def test_cleanup_waits_for_live_io_and_recovers_crashed_work(client, db, user, headers):
    job, resume = inputs(db, user)
    app = create(client, headers, job, resume).json()
    row = db.get(Application, app["id"])
    row.status, row.claim_token, row.claim_until = "submitting", "active-operation", utcnow() - timedelta(minutes=10)
    draft = MailDraft(user_id=user.id, recipient="qa@example.test", subject="QA", body="QA", status="sending",
        updated_at=utcnow() - timedelta(minutes=10))
    db.add(draft)
    db.commit()
    draft_id = draft.id
    with live_io(user.id):
        result = client.request("DELETE", "/api/v1/account", headers=headers,
            json={"password": PASSWORD, "confirmation": "DELETE MY ACCOUNT"})
        assert result.json()["status"] == "pending", result.text
        cleanup_pending(factory(db))
        db.expire_all()
        assert db.get(Application, app["id"]).status == "submitting"
    cleanup_pending(factory(db))
    db.expire_all()
    assert db.get(AccountDeletion, user.id).status == "complete"
    assert db.get(Application, app["id"]) is None
    assert db.get(MailDraft, draft_id) is None


def test_revoked_mutation_rechecks_version_after_lock(client, db, user, headers, monkeypatch):
    import app.core.security as security
    original = security.lock_active_user
    changed = False
    def revoke_before_lock(session, account):
        nonlocal changed
        if not changed:
            changed = True
            with Session(db.get_bind()) as concurrent:
                current = concurrent.get(User, user.id)
                current.token_version += 1
                concurrent.commit()
        original(session, account)
    monkeypatch.setattr(security, "lock_active_user", revoke_before_lock)
    result = client.patch("/api/v1/account/settings", headers=headers, json={"theme": "ocean"})
    assert result.status_code == 401 and result.json()["detail"]["code"] == "invalid_token"


def test_disabled_tombstone_cannot_recreate_profile_preferences_or_reset_token(db, user):
    from app.domain.auth import verification
    from app.domain.profiles import get_preferences, get_profile
    db.delete(db.get(Profile, user.id))
    db.delete(db.get(Preferences, user.id))
    user.active = False
    db.commit()
    for action in [lambda: get_profile(db, user), lambda: get_preferences(db, user), lambda: verification(db, user, "reset_password")]:
        try:
            action()
        except HTTPException as error:
            assert error.status_code == 401
            db.rollback()
        else:
            raise AssertionError("Disabled account gained private records")
    assert db.get(Profile, user.id) is None and db.get(Preferences, user.id) is None
    assert not db.scalar(select(VerificationToken).where(VerificationToken.user_id == user.id))


def enroll(client, headers):
    response = client.post("/api/v1/auth/mfa/enroll", headers=headers, json={"password": PASSWORD})
    assert response.status_code == 200, response.text
    secret = response.json()["secret"]
    enabled = client.post("/api/v1/auth/mfa/confirm", headers=headers, json={"code": pyotp.TOTP(secret).now()})
    assert enabled.status_code == 200, enabled.text
    result = enabled.json()
    return secret, result["recovery_codes"], result["session"], {"Authorization": "Bearer " + result["session"]["access_token"]}


def test_server_hold_undo_and_reaccept_preserve_history(client, db, user, headers, other_headers):
    job, resume = inputs(db, user)
    response = create(client, headers, job, resume, mode="automatic", idempotency_key="first-swipe-key", undo_window_seconds=5)
    assert response.status_code == 201, response.text
    app = response.json()
    assert app["undo_available"] and app["send_after"]
    assert workers.run_worker_once(factory(db)) == 0
    assert client.post(f'/api/v1/applications/{app["id"]}/undo', headers=other_headers).status_code == 404
    undone = client.post(f'/api/v1/applications/{app["id"]}/undo', headers=headers)
    assert undone.status_code == 200 and undone.json()["error_code"] == "swipe_undone"
    assert client.post(f'/api/v1/applications/{app["id"]}/undo', headers=headers).status_code == 200
    assert client.get("/api/v1/automation", headers=headers).json()["used_today"] == 0
    assert job.id in {item["id"] for item in client.get("/api/v1/jobs?exclude_handled=true", headers=headers).json()["items"]}
    accepted = create(client, headers, job, resume, mode="automatic", idempotency_key="second-swipe-key", undo_window_seconds=5).json()
    assert accepted["id"] == app["id"] and accepted["status"] == "queued"
    db.expire_all()
    row = db.get(Application, app["id"])
    row.send_after = utcnow() - timedelta(seconds=1)
    db.commit()
    assert client.post(f'/api/v1/applications/{app["id"]}/undo', headers=headers).status_code == 409
    workers.run_worker_once(factory(db))
    final = client.get(f'/api/v1/applications/{app["id"]}', headers=headers).json()
    assert final["status"] == "applied" and final["attempts"] == 1
    history = client.get(f'/api/v1/applications/{app["id"]}/events', headers=headers).json()["items"]
    assert [event["event_type"] for event in history].count("swipe_undone") == 1
    assert [event["event_type"] for event in history].count("queued") == 2


def test_submission_badges_reflect_server_configuration(client, db, user, headers, settings):
    job, _ = inputs(db, user, demo=False)
    path = f"/api/v1/jobs/{job.id}"
    assert client.get(path, headers=headers).json()["submission"]["automatic"] is False
    settings.allow_external_submissions = True
    settings.webhook_connector_url = "https://employer.example/submit"
    settings.webhook_connector_secret = "a-strong-test-signing-secret"
    settings.connector_allowed_hosts = ["employer.example"]
    assert client.get(path, headers=headers).json()["submission"]["label"] == "Auto-apply available"
    settings.connector_allowed_hosts = []
    assert client.get(path, headers=headers).json()["submission"]["automatic"] is False
    job.connector_key = "unsupported"
    job.apply_url = "https://employer.example/careers"
    db.commit()
    submission = client.get(path, headers=headers).json()["submission"]
    assert submission["kind"] == "manual" and submission["url"] == job.apply_url
    assert settings.webhook_connector_secret not in json.dumps(submission)


def test_reviewed_resume_ranking_and_factual_targeted_draft(client, db, user, headers, other_headers):
    job, resume = inputs(db, user)
    resume.is_main = False
    worse = Resume(user_id=user.id, title="Cloud résumé", reviewed=True, is_main=True,
                   extracted_text="AWS", profile_data={"skills": ["AWS"]})
    db.add(worse)
    db.commit()
    choices = client.get(f"/api/v1/jobs/{job.id}/resume-recommendations", headers=headers).json()
    assert choices["recommended_id"] == resume.id and len(choices["items"]) == 2
    payload = {"job_id": job.id, "version": resume.version}
    preview = client.post(f"/api/v1/resumes/{resume.id}/tailoring-preview", headers=headers, json=payload).json()
    assert preview["suggested_text"].endswith(resume.extracted_text)
    assert "AWS" not in preview["suggested_text"]
    response = client.post(f"/api/v1/resumes/{resume.id}/tailor", headers=headers, json=payload)
    assert response.status_code == 201
    draft = response.json()
    assert not draft["reviewed"] and draft["target_role"] == job.title and draft["document_id"] is None
    assert draft["profile_data"] == resume.profile_data
    assert client.post(f"/api/v1/resumes/{resume.id}/tailor", headers=other_headers, json=payload).status_code == 404
    payload["version"] += 1
    assert client.post(f"/api/v1/resumes/{resume.id}/tailor", headers=headers, json=payload).status_code == 409


def test_schedule_reminders_are_durable_owned_and_not_duplicated(client, db, user, headers, other_headers):
    job, resume = inputs(db, user)
    app = create(client, headers, job, resume).json()
    payload = {"application_id": app["id"], "kind": "interview", "title": "Interview\nBEGIN:VEVENT",
               "due_at": (utcnow() + timedelta(hours=2)).isoformat() + "Z",
               "remind_at": (utcnow() - timedelta(seconds=1)).isoformat() + "Z", "notes": "Bring questions"}
    result = client.post("/api/v1/application-tasks", headers=headers, json=payload)
    assert result.status_code == 201, result.text
    task = result.json()
    assert client.get("/api/v1/application-tasks", headers=other_headers).json()["items"] == []
    assert client.patch(f'/api/v1/application-tasks/{task["id"]}', headers=other_headers, json={"done": True}).status_code == 404
    workers.run_worker_once(factory(db))
    workers.run_worker_once(factory(db))
    notices = db.scalars(select(Notification).where(Notification.user_id == user.id, Notification.kind == "interview")).all()
    assert len(notices) == 1
    calendar = client.get(f'/api/v1/application-tasks/{task["id"]}/calendar', headers=headers).text
    assert calendar.count("\r\nBEGIN:VEVENT\r\n") == 1
    assert "SUMMARY:Interview\\nBEGIN:VEVENT" in calendar
    assert client.patch(f'/api/v1/application-tasks/{task["id"]}', headers=headers, json={"done": True}).json()["done"]
    payload["due_at"] = "2026-10-12T16:00:00"
    assert client.post("/api/v1/application-tasks", headers=headers, json=payload).status_code == 422


def test_account_settings_sync_and_owner_scope(client, headers, other_headers):
    changed = client.patch("/api/v1/account/settings", headers=headers, json={"theme": "ocean", "text_size": "large", "auto_resume": False})
    assert changed.status_code == 200
    assert client.get("/api/v1/account/settings", headers=headers).json()["theme"] == "ocean"
    assert client.get("/api/v1/account/settings", headers=other_headers).json()["theme"] == "paper"
    assert client.patch("/api/v1/account/settings", headers=headers, json={"theme": "invented"}).status_code == 422


def test_mfa_login_refresh_recovery_and_secret_storage(client, db, user, headers, settings):
    initial = client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD}).json()
    secret, codes, session, elevated = enroll(client, headers)
    db.expire_all()
    factor = db.get(MfaFactor, user.id)
    assert secret not in factor.secret_encrypted and SecretBox().decrypt(factor.secret_encrypted) == secret
    assert len(codes) == 10 and codes[0] not in factor.recovery_hashes
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": initial["refresh_token"]}).status_code == 401
    challenge = client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD}).json()
    assert challenge["mfa_required"] and "access_token" not in challenge
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + challenge["challenge_token"]}).status_code == 401
    verified = client.post("/api/v1/auth/mfa/verify-login", json={"challenge_token": challenge["challenge_token"], "code": codes[0]})
    assert verified.status_code == 200
    assert client.post("/api/v1/auth/mfa/verify-login", json={"challenge_token": challenge["challenge_token"], "code": codes[1]}).status_code == 401
    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]})
    assert refreshed.status_code == 200
    claims = jwt.decode(refreshed.json()["access_token"], settings.jwt_secret, algorithms=["HS256"], audience="cyberapply-api")
    assert claims["aal"] == 2
    assert client.get("/api/v1/auth/mfa/status", headers=elevated).json()["recovery_codes_remaining"] == 9


def test_mfa_replay_lockout_challenge_scope_and_expiry(client, db, user, headers):
    secret, codes, _, _ = enroll(client, headers)
    credentials = {"email": user.email, "password": PASSWORD}
    challenge = client.post("/api/v1/auth/login", json=credentials).json()
    payload = {"challenge_token": challenge["challenge_token"], "code": pyotp.TOTP(secret).now()}
    assert client.post("/api/v1/auth/mfa/verify-login", json=payload).status_code == 401  # Enrollment used it.
    db.expire_all()
    row = db.scalar(select(AuthChallenge).where(AuthChallenge.token_hash == digest(challenge["challenge_token"])))
    row.purpose = "export"
    db.commit()
    payload["code"] = codes[0]
    assert client.post("/api/v1/auth/mfa/verify-login", json=payload).status_code == 401
    row.purpose, row.expires_at = "login", utcnow() - timedelta(seconds=1)
    db.commit()
    assert client.post("/api/v1/auth/mfa/verify-login", json=payload).status_code == 401
    for _ in range(4):
        newer = client.post("/api/v1/auth/login", json=credentials).json()
        bad = client.post("/api/v1/auth/mfa/verify-login", json={"challenge_token": newer["challenge_token"], "code": "not-a-valid-recovery-code"})
        assert bad.status_code == 401
    assert client.post("/api/v1/auth/login", json=credentials).status_code == 429
    db.expire_all()
    assert db.get(MfaFactor, user.id).failed_checks == 5


def test_concurrent_recovery_verification_accepts_once(settings, tmp_path):
    engine = create_engine("sqlite:///" + (tmp_path / "mfa.sqlite").as_posix(), connect_args={"check_same_thread": False, "timeout": 30})
    Base.metadata.create_all(engine)
    code = "a" * 32
    with Session(engine) as db:
        user = User(email="concurrent@example.com", active=True)
        db.add(user)
        db.flush()
        user_id = user.id
        db.add(MfaFactor(user_id=user_id, enabled=True, secret_encrypted=SecretBox().encrypt(pyotp.random_base32()), recovery_hashes=[digest(code)]))
        db.commit()
    def verify():
        with Session(engine) as db:
            try:
                verify_factor(db, db.get(User, user_id), code)
                db.commit()
                return True
            except HTTPException:
                db.rollback()
                return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(lambda _: verify(), range(2))).count(True) == 1
    engine.dispose()


def test_export_and_deletion_are_private_and_remove_owned_files(client, db, user, headers, other_user, settings):
    job, resume = inputs(db, user)
    create(client, headers, job, resume)
    storage = Storage()
    storage.put("qa/private.txt", b"own private file", "text/plain")
    document = Document(user_id=user.id, kind="resume", filename="../../private.txt", content_type="text/plain",
        storage_key="qa/private.txt", size_bytes=16, sha256="a" * 64)
    other = Resume(user_id=other_user.id, title="Other secret", extracted_text="other-person-private-data")
    db.add_all([document, other])
    db.commit()
    exported = client.post("/api/v1/account/export", headers=headers, json={"password": PASSWORD})
    assert exported.status_code == 200, exported.text
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        data = archive.read("cyberapply-data.json").decode()
        assert "other-person-private-data" not in data and user.password_hash not in data
        assert "storage_key" not in data and "secret_encrypted" not in data
        assert all(".." not in name.split("/") for name in archive.namelist())
        assert len(archive.namelist()) == 2
    assert client.request("DELETE", "/api/v1/account", headers=headers, json={"password": PASSWORD, "confirmation": "DELETE"}).status_code == 422
    removed = client.request("DELETE", "/api/v1/account", headers=headers, json={"password": PASSWORD, "confirmation": "DELETE MY ACCOUNT"})
    assert removed.status_code == 202 and removed.json()["status"] == "complete"
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
    db.expire_all()
    assert not db.get(User, user.id).active and db.get(User, user.id).email is None
    assert db.get(Resume, other.id) is not None
    assert not storage._path("qa/private.txt").exists()


def test_deletion_cleanup_retries_storage_failure(client, db, user, headers, monkeypatch):
    db.add(Document(user_id=user.id, kind="resume", filename="owned.txt", storage_key="qa/owned.txt",
                    content_type="text/plain", size_bytes=3, sha256="a" * 64))
    db.commit()
    original = Storage.delete
    monkeypatch.setattr(Storage, "delete", lambda *args: (_ for _ in ()).throw(OSError("offline storage")))
    result = client.request("DELETE", "/api/v1/account", headers=headers, json={"password": PASSWORD, "confirmation": "DELETE MY ACCOUNT"})
    assert result.json()["status"] == "pending"
    db.expire_all()
    assert db.get(AccountDeletion, user.id).storage_keys == ["qa/owned.txt"]
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
    monkeypatch.setattr(Storage, "delete", original)
    cleanup_pending(factory(db))
    db.expire_all()
    assert db.get(AccountDeletion, user.id).status == "complete"


def test_provider_mfa_enforced_using_trusted_factors(client, settings, user, monkeypatch):
    settings.auth_mode = "supabase"
    settings.supabase_url = "https://provider.example"
    settings.supabase_jwt_secret = "test-provider-signing-secret-with-32-characters"
    factor_id = "00000000-0000-4000-8000-000000000001"
    monkeypatch.setattr("httpx.get", lambda *a, **k: httpx.Response(200, json={"id": user.id, "factors": [{"id": factor_id, "status": "verified", "factor_type": "totp"}]}))
    claims = {"sub": user.id, "email": user.email, "aud": "authenticated", "role": "authenticated",
              "iss": settings.supabase_url + "/auth/v1", "iat": utcnow(), "exp": 9999999999, "aal": "aal1"}
    def headers_for(value):
        return {"Authorization": "Bearer " + jwt.encode(value, settings.supabase_jwt_secret, algorithm="HS256")}
    assert client.get("/api/v1/profiles/me", headers=headers_for(claims)).status_code == 401
    assert client.get("/api/v1/auth/mfa/status", headers=headers_for(claims)).json()["verification_required"]
    claims["aal"] = "aal2"
    assert client.get("/api/v1/profiles/me", headers=headers_for(claims)).status_code == 200
    monkeypatch.setattr("httpx.get", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("provider offline")))
    assert client.get("/api/v1/profiles/me", headers=headers_for(claims)).status_code == 503


def test_background_discovery_chooses_best_reviewed_resume_and_honors_preference(db, user):
    job, best = inputs(db, user)
    main = Resume(user_id=user.id, title="Main résumé", extracted_text="Candidate", reviewed=True, is_main=True, profile_data={})
    db.add(main)
    db.get(AutomationSettings, user.id).mode = "automatic"
    db.get(Preferences, user.id).data = {"roles": ["SOC Analyst"]}
    db.commit()
    assert workers.discover_automatic_applications(factory(db)) == 1
    db.expire_all()
    assert db.scalar(select(Application).where(Application.job_id == job.id)).resume_id == best.id
    account = AccountSettings(user_id=user.id, auto_resume=False)
    second = Job(title="SOC Analyst", company="Another QA employer", required_skills=["siem"], is_demo=True, connector_key="demo")
    db.add_all([account, second])
    db.commit()
    assert workers.discover_automatic_applications(factory(db)) == 1
    db.expire_all()
    assert db.scalar(select(Application).where(Application.job_id == second.id)).resume_id == main.id
