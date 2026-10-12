"""Read-only adapters for the official public Greenhouse and Lever job listings."""

from __future__ import annotations

import html
import ipaddress
import json
import math
import re
from html.parser import HTMLParser
from typing import Literal
from urllib.parse import urlsplit

import httpx
from pydantic import Field, field_validator

from app.domain.matching import detect_certifications, detect_skills, is_cybersecurity_job
from app.domain.profiles import StrictModel

MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_SOURCE_ROWS = 10000


class SourceError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class SourceImport(StrictModel):
    provider: Literal["greenhouse", "lever"]
    board_token: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    company: str = Field(min_length=1, max_length=200)
    region: Literal["global", "eu"] = "global"
    cybersecurity_only: bool = True
    limit: int = Field(default=100, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=10000)

    @field_validator("company")
    @classmethod
    def clean_company(cls, value):
        if not value.strip():
            raise ValueError("Company name is required")
        return value.strip()


def validate_public_url(value: str, *, allow_empty: bool = False) -> str:
    """Validate link metadata without fetching it or performing DNS lookups."""
    if not value and allow_empty:
        return ""
    if len(value) > 2048 or any(char.isspace() or ord(char) < 32 for char in value) or "\\" in value:
        raise ValueError("Invalid public job URL")
    try:
        parts = urlsplit(value)
        host = (parts.hostname or "").casefold().rstrip(".")
        port = parts.port
    except ValueError as exc:
        raise ValueError("Invalid public job URL") from exc
    if parts.scheme != "https" or not host or parts.username or parts.password or port not in (None, 443):
        raise ValueError("Job URLs must use public HTTPS without credentials or custom ports")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")) or "." not in host:
        raise ValueError("Private job URLs are not allowed")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        if not re.fullmatch(r"[a-z0-9.-]+", host) or any(not segment or segment.startswith("-") or segment.endswith("-") for segment in host.split(".")):
            raise ValueError("Invalid public hostname") from None
    else:
        if not address.is_global:
            raise ValueError("Private job addresses are not allowed")
    return value


class _TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        if tag in ("p", "div", "li", "br", "h1", "h2", "h3", "h4") and not self.hidden:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)
        if tag in ("p", "div", "li", "h1", "h2", "h3", "h4") and not self.hidden:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain_text(value: str) -> str:
    text = str(value or "")[:300000]
    for _ in range(2):
        decoded = html.unescape(text)
        if decoded == text:
            break
        text = decoded
    parser = _TextParser()
    parser.feed(text)
    result = "".join(parser.parts)
    result = re.sub(r"[ \t]+", " ", result)
    return re.sub(r"\n\s*\n\s*\n+", "\n\n", result).strip()[:100000]


def _fetch_json(url: str, params: dict) -> dict | list:
    # URLs are constructed below from a fixed host and a validated token. Redirects
    # are deliberately disabled, preventing the fixed-host fetch becoming SSRF.
    try:
        with httpx.Client(timeout=httpx.Timeout(15, connect=5), follow_redirects=False, trust_env=False) as client:
            with client.stream("GET", url, params=params, headers={"Accept": "application/json", "User-Agent": "CybersecurityJobAutomation/0.1"}) as response:
                if 300 <= response.status_code < 400:
                    raise SourceError("source_redirect_rejected", "The job source redirected unexpectedly.")
                if response.status_code == 404:
                    raise SourceError("source_not_found", "The public job board was not found.")
                if response.status_code == 429:
                    raise SourceError("source_rate_limited", "The public job source rate limit was reached. Try later.")
                if response.status_code != 200:
                    raise SourceError("source_unavailable", "The public job source is currently unavailable.")
                chunks: list[bytes] = []
                length = 0
                for chunk in response.iter_bytes():
                    length += len(chunk)
                    if length > MAX_SOURCE_BYTES:
                        raise SourceError("source_too_large", "The public job-source response exceeded the size limit.")
                    chunks.append(chunk)
                data = json.loads(b"".join(chunks))
    except SourceError:
        raise
    except (httpx.HTTPError, ValueError, RecursionError) as exc:
        raise SourceError("source_unavailable", "The public job-source response could not be read.") from exc
    if not isinstance(data, (dict, list)):
        raise SourceError("source_invalid_response", "The public job source returned an unsupported response.")
    return data


def _level(title: str) -> str:
    lower = title.casefold()
    for label, words in (
        ("executive", ("chief", "ciso", "vp ", "vice president")), ("director", ("director",)),
        ("manager", ("manager",)), ("lead", ("lead", "principal", "staff")),
        ("senior", ("senior", "sr.", "sr ")), ("intern", ("intern",)),
        ("entry", ("junior", "entry", "associate")),
    ):
        if any(word in lower for word in words):
            return label
    return "unspecified"


def _employment(value: str) -> str:
    value = value.casefold().replace("-", " ")
    return next((label for label, words in (
        ("part_time", ("part time",)), ("full_time", ("full time", "fulltime")),
        ("contract", ("contract",)), ("internship", ("intern",)), ("temporary", ("temporary",))
    ) if any(word in value for word in words)), "unspecified")


def _salary(value) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 100000000:
        return float(value)
    return None


def fetch_public_jobs(payload: SourceImport) -> tuple[list[dict], dict]:
    """Return normalized jobs and source metadata. Never submit applications."""
    # Validate again because this function can also be called by non-HTTP code.
    payload = SourceImport.model_validate(payload.model_dump())
    if payload.provider == "greenhouse":
        data = _fetch_json(f"https://boards-api.greenhouse.io/v1/boards/{payload.board_token}/jobs", {"content": "true"})
        rows = data.get("jobs") if isinstance(data, dict) else None
    else:
        host = "api.eu.lever.co" if payload.region == "eu" else "api.lever.co"
        data = _fetch_json(f"https://{host}/v0/postings/{payload.board_token}", {"mode": "json", "limit": payload.limit, "skip": payload.offset})
        rows = data if isinstance(data, list) else None
    if not isinstance(rows, list) or len(rows) > MAX_SOURCE_ROWS:
        raise SourceError("source_invalid_response", "The public job source returned an unsupported job list.")
    normalized: list[dict] = []
    skipped = 0
    selected = rows[payload.offset:] if payload.provider == "greenhouse" else rows
    for row in selected:
        if not isinstance(row, dict):
            skipped += 1
            continue
        title_value = row.get("title") if payload.provider == "greenhouse" else row.get("text")
        title = plain_text(str(title_value or ""))[:300]
        identifier = row.get("id")
        if not title or identifier is None or len(str(identifier)) > 200:
            skipped += 1
            continue
        if payload.provider == "greenhouse":
            description = plain_text(row.get("content") or "")
            location_data = row.get("location") or {}
            location = str(location_data.get("name", ""))[:300] if isinstance(location_data, dict) else ""
            source_url = row.get("absolute_url") or ""
            apply_url = source_url
            workplace = "remote" if "remote" in location.casefold() else "hybrid" if "hybrid" in location.casefold() else "unspecified"
            attributes = {"source_updated_at": row.get("updated_at"), "workplace_type": workplace}
            employment, salary_min, salary_max, currency = "unspecified", None, None, "USD"
        else:
            sections = [row.get("descriptionPlain") or plain_text(row.get("description") or "")]
            for section in row.get("lists") or []:
                if isinstance(section, dict):
                    sections.extend([str(section.get("text") or ""), plain_text(section.get("content") or "")])
            sections.append(row.get("additionalPlain") or plain_text(row.get("additional") or ""))
            description = "\n\n".join(str(section) for section in sections if section)[:100000]
            categories = row.get("categories") if isinstance(row.get("categories"), dict) else {}
            location = str(categories.get("location") or "")[:300]
            source_url, apply_url = row.get("hostedUrl") or "", row.get("applyUrl") or row.get("hostedUrl") or ""
            workplace = {"on-site": "onsite", "remote": "remote", "hybrid": "hybrid"}.get(row.get("workplaceType"), "unspecified")
            attributes = {"country": row.get("country"), "workplace_type": workplace, "team": categories.get("team"), "department": categories.get("department")}
            employment = _employment(str(categories.get("commitment") or ""))
            salary = row.get("salaryRange") if isinstance(row.get("salaryRange"), dict) else {}
            salary_min, salary_max = _salary(salary.get("min")), _salary(salary.get("max"))
            currency = salary.get("currency") or "USD"
            if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
                salary_min, salary_max, currency = None, None, "USD"
            if salary_min is not None and salary_max is not None and salary_min > salary_max:
                salary_min, salary_max = None, None
            raw_interval = str(salary.get("interval") or "").casefold()
            attributes["salary_interval"] = {"per-year": "year", "year": "year", "annual": "year", "per-month": "month", "month": "month", "per-week": "week", "week": "week", "per-hour": "hour", "hour": "hour"}.get(raw_interval, "unspecified")
        if payload.cybersecurity_only and not is_cybersecurity_job(title, description):
            skipped += 1
            continue
        try:
            source_url = validate_public_url(source_url)
            apply_url = validate_public_url(apply_url)
        except (ValueError, TypeError):
            skipped += 1
            continue
        attributes.update({"board_token": payload.board_token, "region": payload.region, "skills_basis": "job_description_mentions", "certification_mentions": detect_certifications(description), "mandatory_eligibility": {}})
        normalized.append({
            "source": payload.provider, "source_id": str(identifier), "title": title,
            "company": payload.company, "description": description, "location": location,
            "remote": workplace == "remote", "employment_type": employment, "level": _level(title),
            "salary_min": salary_min, "salary_max": salary_max, "currency": currency,
            "required_skills": detect_skills(description), "required_certifications": [], "attributes": attributes,
            "source_url": source_url, "apply_url": apply_url, "connector_key": "unsupported", "is_demo": False, "active": True,
        })
        if len(normalized) >= payload.limit:
            break
    return normalized, {"provider": payload.provider, "board_token": payload.board_token, "received": len(rows), "selected": len(normalized), "skipped": skipped, "offset": payload.offset, "listing_only": True}
