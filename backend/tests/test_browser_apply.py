import hashlib
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app import workers
from app.core.storage import Storage
from app.models import Application, Document, Job, Profile, Resume
from app.services.browser_apply import BrowserFormConnector
from app.workers import ApplicationAttention, UncertainSubmission


class FakeLocator:
    def __init__(self, page, selector, index=0):
        self.page, self.selector, self.index = page, selector, index
    def count(self):
        if self.selector.startswith("[data-sitekey]"):
            return int(self.page.captcha)
        if self.selector.startswith("input[required]"):
            return 3 if self.page.unmapped_required or (self.page.conditional_unmapped and "#role" in self.page.filled) else 2
        return 0 if self.selector == self.page.missing_selector else 1
    def nth(self, index):
        return FakeLocator(self.page, self.selector, index)
    def is_visible(self):
        if self.selector == "#success":
            return self.page.clicked or self.page.preexisting_confirmation
        return True
    def is_enabled(self):
        return True
    def fill(self, value):
        key = f"{self.selector}[{self.index}]" if self.selector.startswith("input[required]") else self.selector
        self.page.filled[key] = value
    def select_option(self, value):
        self.page.filled[self.selector] = value
    def set_checked(self, value):
        self.page.filled[self.selector] = value
    def set_input_files(self, value):
        self.page.upload = value
    def evaluate(self, expression, _arg=None):
        if "element.getClientRects" in expression:
            return {"visible": True, "mapped": self.index != 2,
                    "label": self.page.required_label if self.index == 2 else "Reviewed field",
                    "tag": "input", "type": "text"}
        return self.page.valid
    def click(self, **_):
        self.page.clicked = True
        if self.page.click_error:
            raise RuntimeError("Click timeout after a possible POST")
        if self.page.post_click_redirect:
            self.page.url = "https://untrusted.example/thanks"
    def wait_for(self, **_):
        if self.page.confirmation_error:
            raise RuntimeError("No confirmation")
    def inner_text(self):
        if self.selector == "#consent-container":
            return self.page.employer_consent_text
        return "receipt-123" if self.selector == "#receipt" else "Application submitted"
    def get_attribute(self, _):
        return "receipt-123"


class FakePage:
    def __init__(self):
        self.url = ""
        self.filled = {}
        self.upload = None
        self.clicked = False
        self.captcha = self.click_error = self.confirmation_error = self.post_click_redirect = False
        self.preexisting_confirmation = False
        self.unmapped_required = self.conditional_unmapped = False
        self.required_label = "Work authorization"
        self.employer_consent_text = "I agree to employer processing."
        self.valid = True
        self.missing_selector = None
    def set_default_timeout(self, _):
        pass
    def goto(self, url, **_):
        self.url = url
    def locator(self, selector):
        return FakeLocator(self, selector)


class FakeContext:
    def __init__(self, page):
        self.page = page
        self.guard = None
    def route(self, _, handler):
        self.guard = handler
    def new_page(self):
        return self.page


class FakeBrowser:
    def __init__(self, page):
        self.context = FakeContext(page)
        self.closed = False
    def new_context(self, **_):
        return self.context
    def close(self):
        self.closed = True


def setup_connector(settings, **field_changes):
    settings.allow_external_submissions = True
    settings.connector_allowed_hosts = ["employer.example.test"]
    fields = {"full_name": {"selector": "#name"}, "email": {"selector": "#email"}, **field_changes}
    settings.browser_connector_config = {"fixture": {"origins": ["https://employer.example.test"], "path_prefixes": ["/apply/"],
                                                     "fields": fields, "submit_selector": "#submit", "confirmation_selector": "#success",
                                                     "confirmation_text": "Application submitted", "receipt_selector": "#receipt"}}
    page = FakePage()
    browser = FakeBrowser(page)
    @contextmanager
    def playwright():
        yield SimpleNamespace(chromium=SimpleNamespace(launch=lambda **_: browser))
    application = SimpleNamespace(id="fixture-application", user_id="fixture-user", idempotency_key="fixture-request",
                                  answers={"full_name": "Candidate", "email": "candidate@example.com", "sponsorship_required": False},
                                  resume_snapshot={}, cover_letter="")
    job = SimpleNamespace(attributes={"browser_connector_key": "fixture"}, apply_url="https://employer.example.test/apply/security-engineer")
    connector = BrowserFormConnector(settings, playwright_factory=playwright)
    return connector, application, job, page, browser


def test_supported_browser_form_requires_explicit_confirmation(settings):
    connector, application, job, page, browser = setup_connector(settings, sponsorship_required={"selector": "#sponsorship", "type": "checkbox"})
    result = connector.submit(application, job)
    assert result.confirmation_id == "receipt-123" and not result.is_demo
    assert page.filled == {"#name": "Candidate", "#email": "candidate@example.com", "#sponsorship": False}
    assert page.clicked and browser.closed


@pytest.mark.parametrize("fault", ["captcha", "missing", "invalid", "missing_answer"])
def test_pre_submission_problems_need_attention_without_clicking(settings, fault):
    connector, application, job, page, browser = setup_connector(settings)
    if fault == "captcha":
        page.captcha = True
    elif fault == "missing":
        page.missing_selector = "#email"
    elif fault == "invalid":
        page.valid = False
    else:
        application.answers.pop("email")
    with pytest.raises(ApplicationAttention):
        connector.submit(application, job)
    assert not page.clicked
    assert browser.closed is (fault != "missing_answer")


def test_new_required_vacancy_question_stops_before_personal_details(settings):
    connector, application, job, page, browser = setup_connector(settings)
    page.unmapped_required = True
    with pytest.raises(ApplicationAttention, match="Work authorization"):
        connector.submit(application, job)
    assert not page.filled and not page.clicked and browser.closed


def test_conditional_required_question_after_role_selection_stops_before_submit(settings):
    connector, application, job, page, browser = setup_connector(settings, role={"selector": "#role", "type": "select"})
    application.answers["role"] = "SOC Analyst"
    page.conditional_unmapped = True
    with pytest.raises(ApplicationAttention, match="Work authorization"):
        connector.submit(application, job)
    assert page.filled["#role"] == "SOC Analyst"
    assert not page.clicked and browser.closed


def test_known_required_vacancy_field_uses_reviewed_candidate_fact(settings):
    connector, application, job, page, browser = setup_connector(settings)
    page.unmapped_required = True
    page.required_label = "Email address"
    assert connector.submit(application, job).confirmation_id == "receipt-123"
    assert page.filled['input[required], textarea[required], select[required], [aria-required="true"][2]'] == "candidate@example.com"
    assert page.clicked and browser.closed


def test_known_label_without_reviewed_answer_still_needs_attention(settings):
    connector, application, job, page, browser = setup_connector(settings)
    page.unmapped_required = True
    page.required_label = "GitHub repository"
    with pytest.raises(ApplicationAttention, match="GitHub repository"):
        connector.submit(application, job)
    assert not page.filled and not page.clicked and browser.closed


def test_employer_consent_is_checked_before_browser_launch(settings):
    connector, application, job, page, browser = setup_connector(settings, consent={"selector": "#consent", "type": "checkbox"})
    with pytest.raises(ApplicationAttention, match="consent"):
        connector.submit(application, job)
    assert not browser.closed and not page.filled and not page.clicked
    application.answers["consent"] = True
    assert connector.submit(application, job).confirmation_id == "receipt-123"
    assert page.filled["#consent"] is True


def test_changed_employer_consent_or_preexisting_confirmation_stops_before_submit(settings):
    connector, application, job, page, browser = setup_connector(settings, consent={"selector": "#consent", "type": "checkbox"})
    connector.registry["fixture"]["consent_text"] = "I agree to employer processing."
    connector.registry["fixture"]["consent_container_selector"] = "#consent-container"
    application.answers["consent"] = True
    page.employer_consent_text = "The employer changed its agreement."
    with pytest.raises(ApplicationAttention, match="agreement changed"):
        connector.submit(application, job)
    assert not page.clicked and not page.filled
    page.employer_consent_text = connector.registry["fixture"]["consent_text"]
    page.preexisting_confirmation = True
    with pytest.raises(ApplicationAttention, match="already visible"):
        connector.submit(application, job)
    assert not page.clicked and not page.filled


@pytest.mark.parametrize("fault", ["click_error", "confirmation_error", "post_click_redirect"])
def test_post_click_problems_are_uncertain_and_must_not_retry(settings, fault):
    connector, application, job, page, browser = setup_connector(settings)
    setattr(page, fault, True)
    with pytest.raises(UncertainSubmission):
        connector.submit(application, job)
    assert page.clicked and browser.closed


def test_browser_rejects_unconfigured_origins_paths_and_external_disabled(settings):
    connector, application, job, page, browser = setup_connector(settings)
    for url in ["http://employer.example.test/apply/role", "https://untrusted.example/apply/role", "https://employer.example.test/account"]:
        job.apply_url = url
        with pytest.raises(ApplicationAttention):
            connector.submit(application, job)
        assert not page.clicked
    settings.allow_external_submissions = False
    with pytest.raises(ApplicationAttention):
        BrowserFormConnector(settings)


def test_browser_aborts_untrusted_navigation_before_request(settings):
    connector, application, job, page, browser = setup_connector(settings)
    connector.submit(application, job)
    actions = []
    route = SimpleNamespace(request=SimpleNamespace(url="https://untrusted.example/steal", is_navigation_request=lambda: True),
                            abort=lambda: actions.append("abort"), continue_=lambda: actions.append("continue"))
    browser.context.guard(route)
    assert actions == ["abort"]


def test_browser_resume_upload_uses_captured_hash_and_owner(settings, db, user):
    connector, application, job, page, browser = setup_connector(settings, resume={"selector": "#resume", "type": "file"})
    data = b"Reviewed resume file"
    digest = hashlib.sha256(data).hexdigest()
    storage = Storage()
    storage.put("fixture/resume.pdf", data, "application/pdf")
    document = Document(user_id=user.id, kind="resume", filename="resume.pdf", content_type="application/pdf", storage_key="fixture/resume.pdf",
                        size_bytes=len(data), sha256=digest)
    db.add(document)
    db.commit()
    application.user_id = user.id
    application.resume_snapshot = {"document_id": document.id, "document_sha256": digest}
    from sqlalchemy.orm import sessionmaker
    connector.session_factory = sessionmaker(bind=db.bind, expire_on_commit=False)
    assert connector.submit(application, job).confirmation_id == "receipt-123"
    assert page.upload["buffer"] == data
    page.clicked = False
    application.user_id = "another-owner"
    with pytest.raises(ApplicationAttention):
        connector.submit(application, job)
    application.user_id = user.id
    connector.storage_factory = lambda: SimpleNamespace(get=lambda _: b"Changed content")
    with pytest.raises(ApplicationAttention):
        connector.submit(application, job)
    assert not page.clicked


def test_browser_reconciliation_does_not_fill_or_click(settings):
    connector, application, job, page, browser = setup_connector(settings)
    with pytest.raises(UncertainSubmission):
        connector.reconcile(application, job)
    connector.registry["fixture"]["status_url_template"] = "https://employer.example.test/status/{application_id}"
    assert connector.reconcile(application, job).confirmation_id == "receipt-123"
    assert not page.clicked and not page.filled
    assert page.url == "https://employer.example.test/status/fixture-application"


def test_real_browser_submits_only_to_intercepted_employer_fixture(settings, monkeypatch):
    """A real Chromium DOM/form exercise: every request is intercepted locally."""
    from pathlib import Path
    from urllib.parse import parse_qs, urlsplit

    from playwright.sync_api import sync_playwright
    runtime = Path(__file__).resolve().parents[1] / "data" / "browsers"
    if runtime.exists():
        monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(runtime))
    with sync_playwright() as available:
        if not Path(available.chromium.executable_path).exists():
            if Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe").exists():
                settings.browser_channel = "msedge"
            else:
                pytest.skip("A Chromium or Edge runtime is required to exercise the real DOM fixture")
    connector, application, job, _, _ = setup_connector(settings)
    settings.browser_timeout_seconds = 5
    seen = []
    class RouteProxy:
        def __init__(self, route):
            self.route, self.request = route, route.request
        def abort(self):
            self.route.abort()
        def continue_(self):
            path = urlsplit(self.request.url).path
            seen.append((self.request.method, path))
            if self.request.method == "GET" and path == "/apply/security-engineer":
                html = '<form action="/applications" method="post"><input id="name" name="full_name" required><input id="email" type="email" name="email" required><button id="submit" type="submit">Apply</button></form>'
            elif self.request.method == "POST" and path == "/applications":
                fields = parse_qs(self.request.post_data)
                assert fields == {"full_name": ["Candidate"], "email": ["candidate@example.com"]}
                html = '<h1 id="success">Application submitted</h1><p id="receipt">local-browser-fixture-receipt</p>'
            else:
                self.route.abort()
                pytest.fail("The browser fixture attempted an unexpected request")
            self.route.fulfill(status=200, content_type="text/html", body=html)
    class ContextProxy:
        def __init__(self, context):
            self.context = context
        def route(self, pattern, guard):
            self.context.route(pattern, lambda route: guard(RouteProxy(route)))
        def new_page(self):
            return self.context.new_page()
    class BrowserProxy:
        def __init__(self, browser):
            self.browser = browser
        def new_context(self, **kwargs):
            return ContextProxy(self.browser.new_context(**kwargs))
        def close(self):
            self.browser.close()
    @contextmanager
    def runtime_factory():
        with sync_playwright() as playwright:
            yield SimpleNamespace(chromium=SimpleNamespace(launch=lambda **kw: BrowserProxy(playwright.chromium.launch(**kw))))
    connector = BrowserFormConnector(settings, playwright_factory=runtime_factory)
    assert connector.submit(application, job).confirmation_id == "local-browser-fixture-receipt"
    assert seen == [("GET", "/apply/security-engineer"), ("POST", "/applications")]


def test_swipe_queue_prepares_letter_submits_form_and_tracks_receipt(client, db, user, headers, settings, monkeypatch):
    """Exercise the real worker lifecycle with an intercepted fictional employer."""
    settings.allow_external_submissions = True
    settings.connector_allowed_hosts = ["employer.example.test"]
    settings.browser_connector_config = {
        "fixture": {
            "origins": ["https://employer.example.test"],
            "path_prefixes": ["/apply/"],
            "fields": {
                "full_name": {"selector": "#name"},
                "email": {"selector": "#email"},
                "cover_letter": {"selector": "#letter"},
            },
            "submit_selector": "#submit", "confirmation_selector": "#success",
            "confirmation_text": "Application submitted", "receipt_selector": "#receipt",
        }
    }
    profile = db.get(Profile, user.id)
    profile.data = {"full_name": "Alex Doe", "email": user.email, "skills": ["SIEM"]}
    profile.confirmed = True
    resume = Resume(user_id=user.id, title="Reviewed CV", extracted_text="Alex Doe\nSIEM project", reviewed=True,
                    profile_data={"skills": ["SIEM"]})
    job = Job(title="SOC Analyst", company="Fictional Employer", required_skills=["SIEM"],
              source_url="https://employer.example.test/apply/security-engineer",
              apply_url="https://employer.example.test/apply/security-engineer", connector_key="browser_form",
              attributes={"browser_connector_key": "fixture", "required_fields": ["full_name", "email", "cover_letter"]})
    db.add_all([resume, job])
    db.commit()

    page = FakePage()
    browser = FakeBrowser(page)
    @contextmanager
    def playwright():
        yield SimpleNamespace(chromium=SimpleNamespace(launch=lambda **_: browser))
    monkeypatch.setattr("app.services.browser_apply.sync_playwright", playwright)
    response = client.post("/api/v1/applications", headers=headers, json={
        "job_id": job.id, "resume_id": resume.id, "mode": "automatic", "idempotency_key": "fictional-swipe-001"})
    assert response.status_code == 201
    application_id = response.json()["id"]
    sessions = sessionmaker(bind=db.bind, expire_on_commit=False)

    assert workers.run_worker_once(sessions, max_items=1) == 1
    prepared = client.get(f"/api/v1/applications/{application_id}", headers=headers).json()
    assert prepared["status"] == "ready"
    assert "SOC Analyst" in prepared["cover_letter"]
    assert "SIEM" in prepared["cover_letter"]
    assert prepared["missing_fields"] == []

    assert workers.run_worker_once(sessions) == 1
    result = client.get(f"/api/v1/applications/{application_id}", headers=headers).json()
    assert result["status"] == "applied" and result["confirmation_id"] == "receipt-123"
    assert page.filled["#name"] == "Alex Doe"
    assert page.filled["#email"] == user.email
    assert page.filled["#letter"] == prepared["cover_letter"]
    assert page.clicked and browser.closed
    assert db.scalar(select(Application).where(Application.id == application_id)).attempts == 1
    assert workers.run_worker_once(sessions) == 0
