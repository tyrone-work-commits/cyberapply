import io
import zipfile

import httpx
from pypdf import PdfWriter
from sqlalchemy import select

from app.domain import job_sources
from app.domain.matching import compute_match
from app.models import Job, Profile, Resume


def job_payload(**changes):
    return {"title": "Cybersecurity Analyst", "company": "Example Security", "description": "Monitor SIEM and perform incident response.", "required_skills": ["SIEM", "incident response"], "apply_url": "https://careers.example.com/security", **changes}


def test_profile_confirmation_is_explicit_and_owner_scoped(client, headers, other_headers):
    body = {"data": {"full_name": "Ada Example", "email": "ada@example.com", "skills": ["SIEM"], "work_authorization": {"us": True}}, "confirmed": True}
    response = client.put("/api/v1/profiles/me", headers=headers, json=body)
    assert response.status_code == 200
    assert response.json()["data"]["work_authorization"] == {"US": True}
    assert response.json()["confirmed"] is True
    assert client.get("/api/v1/profiles/me", headers=other_headers).json()["data"].get("full_name") != "Ada Example"
    body.pop("confirmed")
    assert client.put("/api/v1/profiles/me", headers=headers, json=body).json()["confirmed"] is False
    body["data"]["invented_degree"] = "PhD"
    assert client.put("/api/v1/profiles/me", headers=headers, json=body).status_code == 422


def test_profile_and_preferences_validate_unknown_and_unsafe_values(client, headers):
    assert client.put("/api/v1/profiles/me", headers=headers, json={"data": {"portfolio_url": "https://127.0.0.1/private"}}).status_code == 422
    assert client.put("/api/v1/profiles/me", headers=headers, json={"data": {"work_authorization": {"United States": True}}}).status_code == 422
    assert client.put("/api/v1/preferences/me", headers=headers, json={"remote_only": True, "work_modes": ["onsite"]}).status_code == 422
    response = client.put("/api/v1/preferences/me", headers=headers, json={"remote_only": True, "roles": ["Cybersecurity Analyst"], "min_salary": 100000})
    assert response.status_code == 200
    assert response.json()["data"]["work_modes"] == ["remote"]
    assert client.put("/api/v1/preferences/me", headers=headers, json={"min_salary": -1}).status_code == 422


def test_resume_upload_download_review_and_edit_invalidate_review(client, headers, other_headers, db, user):
    text = b"Ada Example\nada@example.com\nSkills\nSIEM, Python\nCertifications\nCISSP training in progress"
    response = client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("../../resume.txt", text, "text/plain")})
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["document"]["filename"] == "resume.txt"
    assert "storage_key" not in result["document"]
    resume, document = result["resume"], result["document"]
    assert resume["reviewed"] is False
    assert "cissp" in resume["profile_data"]["certifications"]
    assert db.get(Profile, user.id).confirmed is False
    assert client.get(f"/api/v1/documents/{document['id']}/download", headers=headers).content == text
    assert client.get(f"/api/v1/documents/{document['id']}/download", headers=other_headers).status_code == 404
    assert client.get(f"/api/v1/resumes/{resume['id']}", headers=other_headers).status_code == 404
    assert client.delete(f"/api/v1/documents/{document['id']}", headers=headers).status_code == 409
    review = {"version": 1, "profile_data": {"full_name": "Ada Example", "email": "ada@example.com", "skills": ["SIEM", "Python"], "certifications": []}, "apply_to_profile": True}
    reviewed = client.post(f"/api/v1/resumes/{resume['id']}/review", headers=headers, json=review)
    assert reviewed.status_code == 200
    assert reviewed.json()["resume"]["reviewed"] is True
    assert reviewed.json()["resume"]["profile_data"]["certifications"] == []
    assert reviewed.json()["profile"]["confirmed"] is True
    assert client.post(f"/api/v1/resumes/{resume['id']}/review", headers=headers, json=review).status_code == 409
    edited = client.put(f"/api/v1/resumes/{resume['id']}", headers=headers, json={"version": 2, "text": "New resume content"})
    assert edited.status_code == 200
    assert edited.json()["version"] == 3
    assert edited.json()["reviewed"] is False
    assert edited.json()["document_id"] is None
    assert client.get(f"/api/v1/resumes/{resume['id']}/download", headers=headers).text == "New resume content"


def _docx(xml: bytes, extra_name: str | None = None):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", xml)
        if extra_name:
            archive.writestr(extra_name, "unsupported")
    return buffer.getvalue()


def test_docx_extraction_is_bounded_and_rejects_entities_and_traversal(client, headers):
    document_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    xml = b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Skills: Python and incident response</w:t></w:r></w:p></w:body></w:document>'
    response = client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("resume.docx", _docx(xml), document_type)})
    assert response.status_code == 201, response.text
    assert "Python and incident response" in response.json()["resume"]["extracted_text"]
    assert client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("resume.docx", _docx(xml, "../outside.xml"), document_type)}).status_code == 422
    entities = b'<!DOCTYPE doc [<!ENTITY secret SYSTEM "file:///private">]><doc>&secret;</doc>'
    assert client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("resume.docx", _docx(entities), document_type)}).status_code == 422


def test_pdf_without_readable_text_requires_manual_review(client, headers):
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buffer = io.BytesIO()
    writer.write(buffer)
    response = client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("scan.pdf", buffer.getvalue(), "application/pdf")})
    assert response.status_code == 201, response.text
    resume = response.json()["resume"]
    assert resume["extraction_status"] == "manual_review_required"
    assert resume["reviewed"] is False
    assert resume["profile_data"] == {"skills": [], "certifications": []}


def test_upload_limits_type_checks_and_manual_resume_selection(client, headers, settings, db, user):
    settings.max_upload_bytes = 1024
    assert client.post("/api/v1/documents", headers=headers, files={"file": ("large.txt", b"x" * 1025, "text/plain")}).status_code == 413
    assert client.post("/api/v1/documents", headers=headers, files={"file": ("wrong.pdf", b"not a PDF", "application/pdf")}).status_code == 422
    assert client.post("/api/v1/documents", headers=headers, files={"file": ("wrong.txt", b"text", "application/pdf")}).status_code == 415
    first = client.post("/api/v1/resumes", headers=headers, json={"title": "First", "text": "Experience\nSecurity operations"}).json()
    second = client.post("/api/v1/resumes", headers=headers, json={"title": "Second", "text": "Skills\nPython"}).json()
    assert first["is_main"] is True and second["is_main"] is False
    assert client.post(f"/api/v1/resumes/{second['id']}/select", headers=headers).json()["is_main"] is True
    db.expire_all()
    assert len(db.scalars(select(Resume).where(Resume.user_id == user.id, Resume.is_main.is_(True))).all()) == 1


def test_match_reports_skills_missing_credentials_and_unknown_eligibility():
    job = {**job_payload(), "required_certifications": ["CISSP"], "attributes": {"mandatory_eligibility": {"work_authorization_country": "US", "security_clearance": "secret", "sponsorship_available": False}}}
    result = compute_match(job, {"skills": ["security information and event management"], "certifications": []}, {"roles": ["Security Engineer"], "remote_only": True, "min_salary": 90000})
    assert result["score_kind"] == "heuristic_fit"
    assert result["matched_skills"] == ["siem"]
    assert result["missing_skills"] == ["incident response"]
    assert result["missing_certifications"] == ["cissp"]
    assert result["eligible"] is False
    assert {check["status"] for check in result["eligibility_checks"]} == {"unknown"}
    assert result["automatic_preference_eligible"] is False
    assert any(check["preference"] == "role" and check["matches"] is False for check in result["preference_checks"])
    assert any(check["preference"] == "salary" and check["matches"] is None for check in result["preference_checks"])
    assert any("not a hiring probability" in reason for reason in result["reasons"])


def test_imported_jobs_are_private_shared_jobs_are_read_only_and_filters_literal(client, headers, other_headers, db):
    job = client.post("/api/v1/jobs/import", headers=headers, json=job_payload()).json()
    assert client.get(f"/api/v1/jobs/{job['id']}", headers=other_headers).status_code == 404
    assert client.put(f"/api/v1/jobs/{job['id']}", headers=other_headers, json=job_payload()).status_code == 404
    assert client.get("/api/v1/jobs", headers=other_headers).json()["total"] == 0
    shared = Job(owner_id=None, title="Cloud Security Engineer", company="Public Employer", description="Cloud security", source="public", source_id="public-job")
    db.add(shared)
    db.commit()
    assert client.get(f"/api/v1/jobs/{shared.id}", headers=other_headers).status_code == 200
    assert client.delete(f"/api/v1/jobs/{shared.id}", headers=other_headers).status_code == 404
    assert client.get("/api/v1/jobs?q=%25", headers=headers).json()["total"] == 0
    assert client.get("/api/v1/jobs?limit=101", headers=headers).status_code == 422
    assert client.get("/api/v1/jobs?offset=-1", headers=headers).status_code == 422
    assert client.get("/api/v1/jobs").status_code in (401, 403)


def test_job_decisions_and_company_follow_are_idempotent_and_scoped(client, headers, other_headers):
    job = client.post("/api/v1/jobs", headers=headers, json=job_payload()).json()
    first = client.post(f"/api/v1/jobs/{job['id']}/save", headers=headers).json()
    second = client.post(f"/api/v1/jobs/{job['id']}/save", headers=headers).json()
    assert first["id"] == second["id"]
    assert client.post(f"/api/v1/jobs/{job['id']}/pass", headers=headers).json()["decision"] == "passed"
    assert client.get("/api/v1/jobs/saved", headers=headers).json()["total"] == 0
    assert client.get("/api/v1/jobs/saved?decision=passed", headers=headers).json()["total"] == 1
    first_follow = client.post("/api/v1/companies/following", headers=headers, json={"company": "Example Security"}).json()
    second_follow = client.post("/api/v1/companies/following", headers=headers, json={"company": "example security"}).json()
    assert first_follow["id"] == second_follow["id"]
    assert client.delete(f"/api/v1/companies/following/{first_follow['id']}", headers=other_headers).status_code == 404


def _mock_source(monkeypatch, handler):
    original = httpx.Client
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(job_sources.httpx, "Client", lambda **kwargs: original(transport=transport, **kwargs))


def test_greenhouse_source_uses_fixed_host_filters_cyber_jobs_and_deduplicates(client, headers, other_headers, monkeypatch):
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"jobs": [
            {"id": 123, "title": "Cloud Security Engineer", "location": {"name": "Remote"}, "content": "&lt;p&gt;Python, AWS, and CISSP preferred.&lt;/p&gt;", "absolute_url": "https://boards.greenhouse.io/example/jobs/123"},
            {"id": 124, "title": "Physical Security Guard", "content": "Building access", "absolute_url": "https://boards.greenhouse.io/example/jobs/124"},
        ]})
    _mock_source(monkeypatch, handler)
    payload = {"provider": "greenhouse", "board_token": "example", "company": "Example"}
    first = client.post("/api/v1/jobs/import/source", headers=headers, json=payload)
    assert first.status_code == 200, first.text
    assert first.json()["created"] == 1
    assert first.json()["items"][0]["remote"] is True
    assert first.json()["items"][0]["required_certifications"] == []
    assert first.json()["items"][0]["attributes"]["certification_mentions"] == ["cissp"]
    assert first.json()["items"][0]["connector_key"] == "unsupported"
    assert requests[0].url.host == "boards-api.greenhouse.io"
    assert requests[0].url.path == "/v1/boards/example/jobs"
    assert requests[0].method == "GET"
    second = client.post("/api/v1/jobs/import/source", headers=headers, json=payload).json()
    assert second["created"] == 0 and second["updated"] == 1
    assert second["items"][0]["id"] == first.json()["items"][0]["id"]
    assert client.post("/api/v1/jobs/import/source", headers=other_headers, json=payload).json()["created"] == 1
    assert client.post("/api/v1/jobs/import/source", headers=headers, json={**payload, "board_token": "https://127.0.0.1"}).status_code == 422


def test_sources_reject_redirects_oversized_payloads_and_private_apply_links(client, headers, monkeypatch):
    payload = {"provider": "greenhouse", "board_token": "example", "company": "Example"}
    with monkeypatch.context() as source_patch:
        _mock_source(source_patch, lambda request: httpx.Response(302, headers={"Location": "https://127.0.0.1"}))
        response = client.post("/api/v1/jobs/import/source", headers=headers, json=payload)
        assert response.status_code == 502
        assert response.json()["detail"]["code"] == "source_redirect_rejected"
    with monkeypatch.context() as source_patch:
        _mock_source(source_patch, lambda request: httpx.Response(200, json={"jobs": [{"id": 1, "title": "Cybersecurity Analyst", "absolute_url": "https://127.0.0.1/job", "content": "SIEM"}]}))
        assert client.post("/api/v1/jobs/import/source", headers=headers, json=payload).json()["created"] == 0
        source_patch.setattr(job_sources, "MAX_SOURCE_BYTES", 32)
        response = client.post("/api/v1/jobs/import/source", headers=headers, json=payload)
        assert response.status_code == 502
        assert response.json()["detail"]["code"] == "source_too_large"


def test_resume_analysis_and_optimization_are_manual_and_do_not_fabricate_credentials(client, headers):
    resume = client.post("/api/v1/resumes", headers=headers, json={"text": "Skills\nSIEM", "profile_data": {"skills": ["SIEM"]}}).json()
    job = client.post("/api/v1/jobs", headers=headers, json=job_payload(required_certifications=["CISSP"])).json()
    response = client.post(f"/api/v1/resumes/{resume['id']}/optimize", headers=headers, json={"job_id": job["id"]})
    assert response.status_code == 200
    report = response.json()
    assert report["optimization_kind"] == "heuristic_manual_suggestions"
    assert report["match"]["missing_certifications"] == ["cissp"]
    assert any("Do not claim" in suggestion["message"] for suggestion in report["suggestions"])
    assert client.get(f"/api/v1/resumes/{resume['id']}", headers=headers).json()["reviewed"] is False


def test_lever_source_maps_listing_fields_and_annual_salary_without_claiming_certifications(client, headers, monkeypatch):
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=[{"id": "lever-123", "text": "Senior Cybersecurity Analyst", "categories": {"location": "London", "commitment": "Full-time"}, "country": "GB", "workplaceType": "hybrid", "descriptionPlain": "Security monitoring using SIEM", "lists": [{"text": "Preferred experience", "content": "<li>Python and CISSP desirable</li>"}], "hostedUrl": "https://jobs.eu.lever.co/example/lever-123", "applyUrl": "https://jobs.eu.lever.co/example/lever-123/apply", "salaryRange": {"currency": "GBP", "interval": "per-year", "min": 75000, "max": 95000}}])
    _mock_source(monkeypatch, handler)
    response = client.post("/api/v1/jobs/import/source", headers=headers, json={"provider": "lever", "board_token": "example", "company": "Example", "region": "eu", "offset": 10, "limit": 20})
    assert response.status_code == 200, response.text
    job = response.json()["items"][0]
    assert job["level"] == "senior"
    assert job["employment_type"] == "full_time"
    assert job["attributes"]["workplace_type"] == "hybrid"
    assert job["remote"] is False
    assert job["attributes"]["salary_interval"] == "year"
    assert job["salary_max"] == 95000 and job["currency"] == "GBP"
    assert job["required_certifications"] == []
    assert "python" in job["required_skills"]
    assert requests[0].url.host == "api.eu.lever.co"
    assert requests[0].url.params["skip"] == "10"
    assert requests[0].url.params["limit"] == "20"
