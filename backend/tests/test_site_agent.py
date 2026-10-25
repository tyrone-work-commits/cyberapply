"""The Site companion stops before submission for unreviewed employer forms."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.workers import ApplicationAttention

path = Path(__file__).resolve().parents[1] / "scripts" / "site-agent.py"
spec = importlib.util.spec_from_file_location("site_agent", path)
site_agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site_agent)


def test_registry_requires_exact_employer_origin_and_path():
    registry = {"fixture": {"company": "Fictional Employer", "apply_urls": ["https://careers.example.test/jobs/security/123"], "origins": ["https://careers.example.test"], "path_prefixes": ["/jobs/security/"]}}
    job = {"company": "Fictional Employer", "applyUrl": "https://careers.example.test/jobs/security/123"}
    assert site_agent.configured_form(job, registry)[0] == "fixture"
    for changed in [
        {**job, "company": "Other Employer"},
        {**job, "applyUrl": "https://other.example.test/jobs/security/123"},
        {**job, "applyUrl": "https://careers.example.test/jobs/finance/123"},
        {**job, "applyUrl": "https://careers.example.test/jobs/security/456"},
    ]:
        with pytest.raises(ApplicationAttention):
            site_agent.configured_form(changed, registry)


def test_candidate_answers_use_reviewed_fields_only_and_do_not_invent_screening_answers():
    answers = site_agent.answers_from_candidate({"fullName": "Amina Okafor", "email": "amina@example.test", "skills": ["SIEM"]})
    assert answers["first_name"] == "Amina"
    assert answers["last_name"] == "Okafor"
    assert answers["email"] == "amina@example.test"
    assert "salary" not in answers
    assert "clearance" not in answers


def test_companion_sends_only_a_confirmed_fixture_receipt(monkeypatch):
    registry = {"fixture": {"company": "Fictional Employer", "apply_urls": ["https://careers.example.test/jobs/security/123"], "origins": ["https://careers.example.test"], "path_prefixes": ["/jobs/security/"], "fields": {"full_name": {"selector": "#name"}}, "submit_selector": "#submit", "confirmation_selector": "#success", "receipt_selector": "#receipt"}}
    claim = {"job": {"company": "Fictional Employer", "applyUrl": "https://careers.example.test/jobs/security/123"}, "application": {"id": "request-1", "claimId": "claim-1", "coverLetter": "A reviewed letter", "candidate": {"reviewed": True, "fullName": "Amina Okafor", "email": "amina@example.test"}, "cv": {"name": "cv.txt", "type": "text/plain", "size": 4}}}
    class Response:
        def __init__(self, data=None, content=b""):
            self._data, self.content = data, content
        def raise_for_status(self):
            pass
        def json(self):
            return self._data
    class Client:
        result = None
        def post(self, path, json=None):
            if path.endswith("claim"):
                return Response(claim)
            self.result = json
            return Response({"status": json["status"]})
        def get(self, path, params):
            return Response(content=b"test")
    class Connector:
        def __init__(self, config, upload_provider):
            assert config.browser_connector_config == registry
            assert upload_provider(None)["buffer"] == b"test"
        def submit(self, application, job):
            assert application.answers["first_name"] == "Amina"
            assert application.answers["resume_text"] == "test"
            assert job.apply_url == claim["job"]["applyUrl"]
            return SimpleNamespace(confirmation_id="FIXTURE-RECEIPT")
    monkeypatch.setattr(site_agent, "BrowserFormConnector", Connector)
    client = Client()
    assert site_agent.run_once(client, registry, submit=True)
    assert client.result["status"] == "applied"
    assert client.result["receipt"] == "FIXTURE-RECEIPT"


def test_selected_cv_text_never_falls_back_to_another_profile_cv():
    assert site_agent.selected_cv_text("selected.txt", b"Skills: SIEM") == "Skills: SIEM"
    assert site_agent.selected_cv_text("selected.doc", b"Skills: SIEM") == ""
    assert site_agent.selected_cv_text("broken.txt", b"\x00") == ""


def test_unconfigured_employer_needs_attention_without_browser(monkeypatch):
    class Response:
        def __init__(self, data): self.data = data
        def raise_for_status(self): pass
        def json(self): return self.data
    class Client:
        result = None
        def post(self, path, json=None):
            if path.endswith("claim"):
                return Response({"job": {"company": "Unknown", "applyUrl": "https://unknown.example.test/apply"}, "application": {"id": "a", "claimId": "b", "candidate": {}, "cv": {}}})
            self.result = json
            return Response({"status": json["status"]})
    monkeypatch.setattr(site_agent, "BrowserFormConnector", lambda *_args, **_kwargs: pytest.fail("Browser must not launch"))
    client = Client()
    assert site_agent.run_once(client, {}, submit=True)
    assert client.result["status"] == "needs_attention"
    assert "not been reviewed" in client.result["message"]


def test_bitwealth_pilot_matches_only_the_reviewed_role_and_requires_consent_before_cv_download(monkeypatch):
    registry_path = Path(__file__).resolve().parents[1] / "config" / "site-agent.registry.bitwealth.pilot.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    job = {"company": "Bitwealth Systems Limited", "title": "Cybersecurity Trainee", "applyUrl": "https://www.bitwealthsystems.com.ng/careers"}
    assert site_agent.configured_form(job, registry)[0] == "bitwealth_cybersecurity_trainee"
    with pytest.raises(ApplicationAttention):
        site_agent.configured_form({**job, "title": "Frontend Trainee"}, registry)

    class Response:
        def __init__(self, data): self.data = data
        def raise_for_status(self): pass
        def json(self): return self.data
    class Client:
        result = None
        def post(self, path, json=None):
            if path.endswith("claim"):
                return Response({"job": job, "application": {"id": "pilot-1", "claimId": "claim-1", "employerConsent": False, "candidate": {"reviewed": True}, "cv": {"name": "cv.pdf", "type": "application/pdf", "size": 10}}})
            self.result = json
            return Response({"status": json["status"]})
        def get(self, *_args, **_kwargs):
            pytest.fail("A missing consent must stop the worker before CV download")
    monkeypatch.setattr(site_agent, "BrowserFormConnector", lambda *_args, **_kwargs: pytest.fail("Browser must not launch"))
    client = Client()
    assert site_agent.run_once(client, registry, submit=True)
    assert client.result["status"] == "needs_attention"
    assert "consent" in client.result["message"]
