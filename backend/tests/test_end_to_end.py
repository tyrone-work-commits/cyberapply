"""One complete API journey using a fictional local employer and captured email."""

import json
import smtplib

import httpx
from sqlalchemy.orm import sessionmaker

from app import workers
from app.models import Job


def test_verified_account_to_reviewed_demo_application_and_interview(
    client, db, settings, other_headers, monkeypatch,
):
    def forbid_external_io(*args, **kwargs):
        raise AssertionError("The integrated demo journey must not contact external services")

    # TestClient uses an in-process transport. Any ordinary HTTP or SMTP attempt
    # fails this test, ensuring verification and submission stay local.
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", forbid_external_io)
    monkeypatch.setattr(smtplib, "SMTP_SSL", forbid_external_io)
    assert settings.auth_mode == "local"
    assert settings.auth_email_mode == "capture"
    assert settings.allow_external_submissions is False

    credentials = {"email": "journey@example.com", "password": "Fictional-journey-password-2026"}
    registered = client.post("/api/v1/auth/register", json=credentials)
    assert registered.status_code == 201, registered.text
    assert registered.json()["verification_required"] is True
    assert registered.json()["user"]["email_verified"] is False
    assert "access_token" not in registered.json()

    outbox = settings.storage_dir.parent / "auth-outbox"
    captured = [json.loads(path.read_text(encoding="utf-8")) for path in outbox.glob("*.json")]
    verification = next(message for message in captured if message["recipient"] == credentials["email"] and message["purpose"] == "verify_email")
    verified = client.post("/api/v1/auth/email/verify", json={"token": verification["token"]})
    assert verified.status_code == 200 and verified.json()["verified"] is True
    login = client.post("/api/v1/auth/login", json=credentials)
    assert login.status_code == 200, login.text
    headers = {"Authorization": "Bearer " + login.json()["access_token"]}
    assert client.get("/api/v1/auth/me", headers=headers).json()["email_verified"] is True

    candidate = {
        "full_name": "Ada Fictional", "email": credentials["email"],
        "location": "London", "country": "GB", "skills": ["SIEM", "incident response"],
        "certifications": [], "work_authorization": {"GB": True},
        "sponsorship_required": False, "years_experience": 3,
    }
    profile = client.put("/api/v1/profiles/me", headers=headers, json={"data": candidate, "confirmed": True})
    assert profile.status_code == 200 and profile.json()["confirmed"] is True
    preferences = client.put("/api/v1/preferences/me", headers=headers, json={
        "roles": ["SOC Analyst"], "work_modes": ["remote"], "countries": ["GB"],
        "employment_types": ["full_time"], "levels": ["mid"],
        "min_salary": 35000, "currency": "GBP", "keywords": ["SIEM"],
    })
    assert preferences.status_code == 200, preferences.text

    resume_text = (
        "Ada Fictional\njourney@example.com\nSkills\nSIEM and incident response\n"
        "Experience\nFictional security monitoring role\nEducation\nUser-entered sample resume"
    ).encode("utf-8")
    uploaded = client.post("/api/v1/resumes/upload", headers=headers,
                           files={"file": ("fictional-resume.txt", resume_text, "text/plain")})
    assert uploaded.status_code == 201, uploaded.text
    resume, document = uploaded.json()["resume"], uploaded.json()["document"]
    assert resume["reviewed"] is False
    reviewed = client.post(f"/api/v1/resumes/{resume['id']}/review", headers=headers, json={
        "version": resume["version"], "profile_data": candidate, "apply_to_profile": True,
    })
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["resume"]["reviewed"] is True
    assert reviewed.json()["profile"]["confirmed"] is True
    assert client.get(f"/api/v1/resumes/{resume['id']}/download", headers=headers).content == resume_text

    # Only the test fixture can mark a job as a demo; the normal import API cannot
    # grant itself submission capabilities or pretend a live employer accepted it.
    job = Job(
        owner_id=None, source="demo", source_id="integrated-fictional-soc",
        title="SOC Analyst", company="Fictional Demo Cybersecurity Employer",
        description="Fictional SOC role using SIEM and incident response. Local demo only.",
        location="London", remote=True, employment_type="full_time", level="mid",
        salary_min=40000, salary_max=60000, currency="GBP",
        required_skills=["SIEM", "incident response"], required_certifications=[],
        attributes={"country": "GB", "workplace_type": "remote", "salary_interval": "year",
                    "required_fields": ["full_name", "email"],
                    "mandatory_eligibility": {"work_authorization_country": "GB", "sponsorship_available": False}},
        connector_key="demo", is_demo=True, active=True,
    )
    db.add(job)
    db.commit()
    matched = client.get(f"/api/v1/jobs/{job.id}/match", headers=headers)
    assert matched.status_code == 200
    assert matched.json()["score_kind"] == "heuristic_fit"
    assert matched.json()["score"] >= 80 and matched.json()["eligible"] is True
    assert matched.json()["automatic_preference_eligible"] is True
    assert matched.json()["missing_skills"] == []

    created = client.post("/api/v1/applications", headers=headers, json={
        "job_id": job.id, "resume_id": resume["id"], "mode": "review",
        "idempotency_key": "integrated-fictional-journey-01",
    })
    assert created.status_code == 201, created.text
    application = created.json()
    application_id = application["id"]
    assert application["status"] == "queued" and application["attempts"] == 0
    assert application["confirmation_id"] is None
    assert application["resume_snapshot"]["document_id"] == document["id"]
    assert application["resume_snapshot"]["document_sha256"] == document["sha256"]

    factory = sessionmaker(bind=db.bind, expire_on_commit=False)
    assert workers.run_worker_once(factory, max_items=1) == 1
    prepared = client.get(f"/api/v1/applications/{application_id}", headers=headers).json()
    assert prepared["status"] == "needs_review" and prepared["confirmation_id"] is None
    assert prepared["answers"]["full_name"] == candidate["full_name"]
    assert prepared["answers"]["resume_text"] == resume_text.decode("utf-8")
    assert prepared["missing_fields"] == []
    assert client.get("/api/v1/applications/summary", headers=headers).json()["needs_review"] == 1

    approved = client.post(f"/api/v1/applications/{application_id}/approve", headers=headers,
                           json={"expected_version": prepared["version"]})
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "ready"
    assert approved.json()["confirmation_id"] is None
    assert workers.run_worker_once(factory, max_items=1) == 1
    applied = client.get(f"/api/v1/applications/{application_id}", headers=headers).json()
    assert applied["status"] == "applied" and applied["is_demo"] is True
    assert applied["confirmation_id"] == "demo-" + application_id
    assert applied["attempts"] == 1 and applied["submitted_at"] is not None
    assert workers.run_worker_once(factory, max_items=1) == 0

    events = client.get(f"/api/v1/applications/{application_id}/events", headers=headers).json()["items"]
    assert [item["sequence"] for item in events] == list(range(1, 7))
    assert [item["event_type"] for item in events] == ["queued", "preparing", "needs_review", "approved", "submitting", "applied"]
    assert events[-1]["data"]["is_demo"] is True
    notifications = client.get("/api/v1/notifications", headers=headers).json()
    assert notifications["total"] == 2
    assert {item["kind"] for item in notifications["items"]} == {"needs_review", "applied"}
    confirmation_notice = next(item for item in notifications["items"] if item["kind"] == "applied")
    assert confirmation_notice["title"] == "Demo application confirmed"

    outcome = client.patch(f"/api/v1/applications/{application_id}/outcome", headers=headers,
                           json={"outcome": "interview", "expected_version": applied["version"]})
    assert outcome.status_code == 200, outcome.text
    assert outcome.json()["outcome"] == "interview" and outcome.json()["status"] == "applied"
    timeline = client.get(f"/api/v1/applications/{application_id}/events", headers=headers).json()["items"]
    assert [item["sequence"] for item in timeline] == list(range(1, 8))
    assert timeline[-1]["event_type"] == "outcome_updated"
    assert timeline[-1]["data"] == {"previous_outcome": None, "outcome": "interview", "source": "user"}
    summary = client.get("/api/v1/applications/summary", headers=headers).json()
    assert summary["total"] == 1 and summary["by_status"]["applied"] == 1
    assert summary["by_outcome"]["interview"] == 1
    assert summary["needs_review"] == 0 and summary["active"] == 0
    assert summary["unread_notifications"] == 2
    assert client.get("/api/v1/applications?outcome=interview", headers=headers).json()["total"] == 1

    # The second authenticated owner cannot inspect or change any personal item.
    for path in (
        f"/api/v1/applications/{application_id}", f"/api/v1/applications/{application_id}/events",
        f"/api/v1/resumes/{resume['id']}", f"/api/v1/documents/{document['id']}/download",
    ):
        assert client.get(path, headers=other_headers).status_code == 404
    assert client.post(f"/api/v1/applications/{application_id}/approve", headers=other_headers).status_code == 404
    assert client.patch(f"/api/v1/applications/{application_id}/outcome", headers=other_headers,
                        json={"outcome": "offer"}).status_code == 404
    assert client.patch(f"/api/v1/notifications/{confirmation_notice['id']}", headers=other_headers,
                        json={"is_read": True}).status_code == 404
    assert client.get("/api/v1/applications/summary", headers=other_headers).json()["total"] == 0
    assert client.get("/api/v1/notifications", headers=other_headers).json()["total"] == 0
    assert client.patch(f"/api/v1/notifications/{confirmation_notice['id']}", headers=headers,
                        json={"is_read": True}).status_code == 200
    assert client.get("/api/v1/applications/summary", headers=headers).json()["unread_notifications"] == 1
