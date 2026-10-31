"""Opt-in Playwright adapter for administrator-configured employer forms.

This is a supported-form registry, not arbitrary ATS/browser automation. All
selectors and origins come from server configuration, never an application form.
"""
from __future__ import annotations

import hashlib
import re
from urllib.parse import urlsplit

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.storage import Storage
from app.models import Document
from app.services.cv_answers import answer_from_cv
from app.services.salary_research import (
    answer_current_salary_number_question,
    answer_current_salary_question,
    answer_salary_question,
)
from app.workers import ApplicationAttention, SubmissionConfirmation, UncertainSubmission

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


def origin(url: str) -> str:
    try:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Unsupported employer URL")
        port = f":{parsed.port}" if parsed.port and parsed.port != 443 else ""
    except (ValueError, TypeError) as exc:
        raise ApplicationAttention("A configured allowlisted HTTPS employer URL is required") from exc
    return f"https://{parsed.hostname.lower().rstrip('.')}{port}"


class BrowserFormConnector:
    def __init__(self, config, session_factory=None, playwright_factory=None, storage_factory=Storage, upload_provider=None):
        if not config.allow_external_submissions:
            raise ApplicationAttention("External application submissions are disabled")
        self.config = config
        self.registry = getattr(config, "browser_connector_config", {}) or {}
        if not isinstance(self.registry, dict) or not self.registry:
            raise ApplicationAttention("No employer form registry has been configured")
        self.session_factory = session_factory or SessionLocal
        self.playwright_factory = playwright_factory or sync_playwright
        self.storage_factory = storage_factory
        self.upload_provider = upload_provider
        if self.playwright_factory is None:
            raise ApplicationAttention("The Playwright browser runtime is unavailable")
        self.timeout = min(max(float(getattr(config, "browser_timeout_seconds", 30)), 1), 60) * 1000

    def _form(self, job):
        key = (job.attributes or {}).get("browser_connector_key")
        if not isinstance(key, str):
            raise ApplicationAttention("The employer form has no trusted registry key")
        form = self.registry.get(key)
        if not isinstance(form, dict):
            raise ApplicationAttention("The employer form has no trusted selector configuration")
        origins = form.get("origins")
        if not isinstance(origins, list) or not origins:
            raise ApplicationAttention("Employer origins are not configured")
        allowed_hosts = {str(host).lower().rstrip(".") for host in self.config.connector_allowed_hosts}
        trusted = set()
        for value in origins:
            normalized = origin(value)
            if urlsplit(normalized).hostname not in allowed_hosts:
                raise ApplicationAttention("The configured employer host is outside the server allowlist")
            trusted.add(normalized)
        url = job.apply_url
        if origin(url) not in trusted:
            raise ApplicationAttention("This job URL is outside the configured employer origins")
        prefixes = form.get("path_prefixes", [])
        if not isinstance(prefixes, list) or not prefixes or not any(urlsplit(url).path.startswith(prefix) for prefix in prefixes if isinstance(prefix, str) and prefix.startswith("/")):
            raise ApplicationAttention("This employer URL has no supported path configuration")
        fields = form.get("fields")
        if not isinstance(fields, dict) or not fields or len(fields) > 100:
            raise ApplicationAttention("The employer form needs a bounded field mapping")
        for name, field in fields.items():
            if not isinstance(name, str) or not isinstance(field, dict) or not isinstance(field.get("selector"), str) or not field["selector"] or len(field["selector"]) > 500:
                raise ApplicationAttention("A form field selector is missing or invalid")
            if field.get("type", "text") not in {"text", "select", "checkbox", "file"}:
                raise ApplicationAttention("The configured field type is unsupported")
        if not form.get("submit_selector") or not form.get("confirmation_selector"):
            raise ApplicationAttention("Submit and explicit confirmation selectors must be configured")
        return form, trusted

    def _upload(self, application):
        if self.upload_provider is not None:
            return self.upload_provider(application)
        snapshot = application.resume_snapshot or {}
        document_id = snapshot.get("document_id")
        digest = snapshot.get("document_sha256")
        if not document_id or not digest:
            raise ApplicationAttention("Upload and review a resume file for this employer form")
        with self.session_factory() as db:
            document = db.scalar(select(Document).where(Document.id == document_id, Document.user_id == application.user_id))
            if document is None or document.sha256 != digest:
                raise ApplicationAttention("The captured resume document is unavailable or changed")
            data = self.storage_factory().get(document.storage_key)
            if hashlib.sha256(data).hexdigest() != digest:
                raise ApplicationAttention("The stored resume content does not match the reviewed snapshot")
            return {"name": document.filename, "mimeType": document.content_type, "buffer": data}

    @staticmethod
    def _adapt_required_fields(page, fields, answers):
        """Fill only unmistakable reviewed facts; surface other new questions.

        This runs both before filling and after mapped selections, which can
        reveal additional required questions. A preselected answer is not
        permission to submit an unknown screening response.
        """
        required = page.locator('input[required], textarea[required], select[required], [aria-required="true"]')
        count = required.count()
        if count > 100:
            raise ApplicationAttention("The employer form has too many required questions to review automatically")
        selectors = [mapping["selector"] for mapping in fields.values()]
        labels_to_answers = {
            "full name": "full_name", "first name": "first_name", "last name": "last_name",
            "email": "email", "email address": "email", "your email": "email",
            "linkedin": "linkedin", "linkedin url": "linkedin", "linkedin profile": "linkedin",
            "github": "github", "github url": "github", "github repository": "github",
            "portfolio": "portfolio", "portfolio website": "portfolio", "portfolio url": "portfolio",
        }
        unknown = []
        fill = []
        for index in range(count):
            item = required.nth(index).evaluate("""(element, selectors) => {
                const visible = element.getClientRects().length > 0 &&
                    getComputedStyle(element).visibility !== 'hidden' && !element.disabled;
                const mapped = selectors.some(selector => {
                    try { return element.matches(selector); } catch { return false; }
                });
                const labels = element.labels ? Array.from(element.labels).map(label => label.innerText).join(' ') : '';
                const label = labels || element.getAttribute('aria-label') ||
                    element.closest('label')?.innerText || element.getAttribute('name') ||
                    element.getAttribute('id') || 'Unnamed question';
                return { visible, mapped, label: String(label).replace(/\\s+/g, ' ').trim().slice(0, 80),
                    tag: element.tagName.toLowerCase(), type: (element.getAttribute('type') || 'text').toLowerCase() };
            }""", selectors)
            if item["visible"] and not item["mapped"]:
                label = item["label"] or "Unnamed question"
                normalized = re.sub(r"[^a-z0-9]+", " ", label.lower()).strip()
                answer_key = labels_to_answers.get(normalized)
                answer = answers.get(answer_key) if answer_key else None
                is_text = item["tag"] == "textarea" or (item["tag"] == "input" and item["type"] in {"text", "email", "url"})
                if is_text and not answer_key:
                    answer = (answer_current_salary_question(
                        label, answers.get("current_salary_facts"), answers.get("salary_proposal"))
                              or answer_salary_question(label, answers.get("salary_proposal"))
                              or answer_from_cv(label, answers.get("resume_text", "")))
                if item["tag"] == "input" and item["type"] == "number" and not answer_key:
                    answer = answer_current_salary_number_question(label, answers.get("current_salary_facts"))
                if (is_text or item["tag"] == "input" and item["type"] == "number") and isinstance(answer, str) and answer.strip() and len(answer) <= 500:
                    fill.append((required.nth(index), answer.strip()))
                else:
                    unknown.append(label)
        if unknown:
            labels = ", ".join(dict.fromkeys(unknown[:3]))
            remainder = " and more" if len(unknown) > 3 else ""
            raise ApplicationAttention(f"This vacancy has required employer questions that need review: {labels}{remainder}")
        for locator, answer in fill:
            locator.fill(answer)

    def _browser_operation(self, application, job, *, reconciliation=False):
        form, trusted = self._form(job)
        if not reconciliation:
            # Reject missing consent and other required answers before any personal
            # details are entered into a third-party form.
            for name, mapping in form["fields"].items():
                if mapping.get("type") == "file":
                    continue
                value = application.cover_letter if name == "cover_letter" else application.answers.get(name)
                if name == "consent" and value is not True:
                    raise ApplicationAttention("The employer's data-processing consent has not been confirmed")
                if mapping.get("required", True) and (value is None or value == "" or value == [] or value == {}):
                    raise ApplicationAttention("A required employer answer is missing")
        url = job.apply_url
        if reconciliation:
            template = form.get("status_url_template")
            if not isinstance(template, str) or "{application_id}" not in template:
                raise UncertainSubmission("No employer receipt lookup is configured; obtain confirmation from the employer")
            url = template.replace("{application_id}", application.id).replace("{idempotency_key}", application.idempotency_key)
            if origin(url) not in trusted:
                raise UncertainSubmission("The receipt lookup is outside configured employer origins")
        allowed_resource_hosts = {urlsplit(value).hostname for value in trusted}
        allowed_resource_hosts.update(str(host).lower().rstrip(".") for host in form.get("resource_hosts", [])
                                     if str(host).lower().rstrip(".") in {str(host).lower().rstrip(".") for host in self.config.connector_allowed_hosts})
        clicked = False
        denied_navigation = False
        try:
            with self.playwright_factory() as playwright:
                channel = getattr(self.config, "browser_channel", "chromium")
                if channel not in {"chromium", "msedge", "chrome"}:
                    raise ApplicationAttention("The configured browser channel is unsupported")
                browser = playwright.chromium.launch(headless=True, **({"channel": channel} if channel != "chromium" else {}))
                try:
                    context = browser.new_context(accept_downloads=False, service_workers="block")
                    def guard(route):
                        nonlocal denied_navigation
                        request = route.request
                        try:
                            request_origin = origin(request.url)
                        except (ValueError, ApplicationAttention):
                            route.abort()
                            return
                        if request.is_navigation_request() and request_origin not in trusted:
                            denied_navigation = True
                            route.abort()
                        elif urlsplit(request_origin).hostname not in allowed_resource_hosts:
                            route.abort()
                        else:
                            route.continue_()
                    context.route("**/*", guard)
                    page = context.new_page()
                    page.set_default_timeout(self.timeout)
                    page.goto(url, wait_until="domcontentloaded", timeout=self.timeout)
                    if denied_navigation or origin(page.url) not in trusted:
                        raise ApplicationAttention("The employer redirected outside its configured origins")
                    captcha = page.locator(form.get("captcha_selector", '[data-sitekey], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[name*="captcha"]'))
                    if any(captcha.nth(index).is_visible() for index in range(min(captcha.count(), 10))):
                        raise ApplicationAttention("This employer requires a human CAPTCHA check")
                    if not reconciliation:
                        if form.get("consent_text"):
                            consent_container = page.locator(form.get("consent_container_selector", "form"))
                            if consent_container.count() != 1 or form["consent_text"] not in consent_container.inner_text():
                                raise ApplicationAttention("The employer's data-processing agreement changed; review it before applying")
                        before_confirmation = page.locator(form["confirmation_selector"])
                        if before_confirmation.count() > 1 or (before_confirmation.count() == 1 and before_confirmation.is_visible()):
                            raise ApplicationAttention("The employer confirmation is already visible before submission; review the form mapping")
                        answers = {**application.answers, "cover_letter": application.cover_letter}
                        self._adapt_required_fields(page, form["fields"], answers)
                        for name, mapping in form["fields"].items():
                            locator = page.locator(mapping["selector"])
                            kind = mapping.get("type", "text")
                            if locator.count() != 1:
                                raise ApplicationAttention("A configured employer field is missing or ambiguous")
                            if kind == "file":
                                if name != "resume":
                                    raise ApplicationAttention("Only the captured resume upload is supported")
                                locator.set_input_files(self._upload(application))
                                continue
                            value = application.cover_letter if name == "cover_letter" else application.answers.get(name)
                            if value is None or value == "" or value == [] or value == {}:
                                if mapping.get("required", True):
                                    raise ApplicationAttention("A required employer answer is missing")
                                continue
                            if kind == "checkbox":
                                if not isinstance(value, bool):
                                    raise ApplicationAttention("A checkbox answer must be explicitly true or false")
                                locator.set_checked(value)
                            elif kind == "select":
                                mapped = mapping.get("values", {}).get(str(value), str(value))
                                locator.select_option(str(mapped))
                            elif isinstance(value, (str, int, float)) and not isinstance(value, bool):
                                locator.fill(str(value))
                            else:
                                raise ApplicationAttention("This employer answer needs a supported text or selection mapping")
                        self._adapt_required_fields(page, form["fields"], answers)
                        invalid = page.locator("input[required], textarea[required], select[required]")
                        if invalid.count() > 100 or any(not invalid.nth(index).evaluate("element => element.checkValidity()") for index in range(invalid.count())):
                            raise ApplicationAttention("The employer has unanswered or invalid required fields")
                        submit = page.locator(form["submit_selector"])
                        if submit.count() != 1 or not submit.is_enabled():
                            raise ApplicationAttention("The configured submit control is unavailable")
                        # Mark before click: click timeout may happen after a POST reached the employer.
                        clicked = True
                        submit.click(timeout=self.timeout)
                    confirmation = page.locator(form["confirmation_selector"])
                    confirmation.wait_for(state="visible", timeout=self.timeout)
                    if denied_navigation or origin(page.url) not in trusted:
                        raise UncertainSubmission("The employer left the configured origins after submission")
                    text = form.get("confirmation_text")
                    if text and text not in confirmation.inner_text():
                        raise UncertainSubmission("The employer confirmation text did not match")
                    receipt = None
                    if form.get("receipt_selector"):
                        receipt_locator = page.locator(form["receipt_selector"])
                        receipt = receipt_locator.get_attribute(form["receipt_attribute"]) if form.get("receipt_attribute") else receipt_locator.inner_text()
                        if not isinstance(receipt, str) or not 1 <= len(receipt.strip()) <= 200:
                            raise UncertainSubmission("The employer receipt was empty or invalid")
                    return SubmissionConfirmation(receipt.strip() if receipt else "browser-confirmed-" + application.id)
                finally:
                    browser.close()
        except UncertainSubmission:
            raise
        except Exception as exc:
            if clicked or reconciliation:
                raise UncertainSubmission("Employer confirmation could not be verified; do not resubmit") from exc
            if isinstance(exc, ApplicationAttention):
                raise
            raise ApplicationAttention("The configured employer form could not be prepared; no submit click occurred") from exc

    def submit(self, application, job):
        return self._browser_operation(application, job)

    def reconcile(self, application, job):
        return self._browser_operation(application, job, reconciliation=True)
