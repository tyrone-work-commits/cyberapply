import hashlib
from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from app.core.storage import Storage
from app.models import Document
from app.services.browser_apply import BrowserFormConnector
from app.workers import ApplicationAttention, UncertainSubmission


class FakeLocator:
    def __init__(self, page, selector, index=0):
        self.page, self.selector, self.index = page, selector, index
    def count(self):
        if self.selector.startswith("[data-sitekey]"):
            return int(self.page.captcha)
        if self.selector.startswith("input[required]"):
            return 2
        return 0 if self.selector == self.page.missing_selector else 1
    def nth(self, index):
        return FakeLocator(self.page, self.selector, index)
    def is_visible(self):
        return True
    def is_enabled(self):
        return True
    def fill(self, value):
        self.page.filled[self.selector] = value
    def select_option(self, value):
        self.page.filled[self.selector] = value
    def set_checked(self, value):
        self.page.filled[self.selector] = value
    def set_input_files(self, value):
        self.page.upload = value
    def evaluate(self, _):
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
    assert not page.clicked and browser.closed


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
