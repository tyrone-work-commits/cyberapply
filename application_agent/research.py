"""Bounded public employer research, with no credentials or paid services.

Every connection pins a checked public IP while TLS still verifies the original
hostname. Redirects are rechecked and limited to the same hostname. Network or
parsing failures produce missing evidence, never a guessed salary.
"""
from __future__ import annotations

from datetime import date
from html.parser import HTMLParser
import http.client
import ipaddress
import json
import re
import socket
import ssl
from urllib.parse import urljoin, urlsplit


class ResearchError(ValueError):
    pass


def _target(url: str) -> tuple[str, str, list[str]]:
    try:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in {None, 443}:
            raise ResearchError("Only public HTTPS research pages are supported")
        host = parsed.hostname.encode("idna").decode("ascii").lower().rstrip(".")
        if host in {"localhost", "metadata.google.internal"} or host.endswith((".localhost", ".local", ".internal")):
            raise ResearchError("Private research hosts are not supported")
        records = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        addresses = list(dict.fromkeys(record[4][0] for record in records))
        if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
            raise ResearchError("Research host must resolve only to public addresses")
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        return host, path, addresses
    except (ValueError, UnicodeError, socket.gaierror) as error:
        raise ResearchError("Invalid or unavailable research host") from error


def fetch_public_page(url: str, *, max_bytes: int = 1_000_000, timeout: float = 12) -> dict:
    """Return {url, html}; no cookies, auth, cross-host redirects or private IPs."""
    original_host = urlsplit(url).hostname
    for _ in range(4):
        host, path, addresses = _target(url)
        if host != (original_host or "").lower().rstrip("."):
            raise ResearchError("Research redirect changed hostname")
        connection = http.client.HTTPSConnection(host, timeout=timeout, context=ssl.create_default_context())
        # HTTPSConnection wraps the resulting socket using `host` for SNI and
        # certificate validation, while this callback avoids a second DNS lookup.
        connection._create_connection = lambda _address, timeout=timeout, source_address=None: socket.create_connection((addresses[0], 443), timeout, source_address)
        try:
            connection.request("GET", path, headers={"User-Agent": "CyberApply/1.0 public-job-research", "Accept": "text/html, application/json"})
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                if not location:
                    raise ResearchError("Research page redirect has no destination")
                url = urljoin(url, location)
                continue
            if response.status != 200:
                raise ResearchError(f"Research page returned HTTP {response.status}")
            content_type = response.getheader("Content-Type", "").lower()
            if not any(kind in content_type for kind in ("text/html", "application/json", "text/plain")):
                raise ResearchError("Research page is not readable text")
            content = response.read(max_bytes + 1)
            if len(content) > max_bytes:
                raise ResearchError("Research page exceeded the size limit")
            return {"url": url, "html": content.decode("utf-8", errors="replace")}
        except (OSError, http.client.HTTPException) as error:
            raise ResearchError("Public research page could not be read") from error
        finally:
            connection.close()
    raise ResearchError("Too many research redirects")


class _Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.jsonld, self._json = [], [], []
        self._ignore, self._ld = 0, False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script":
            self._ld = attrs.get("type", "").lower() == "application/ld+json"
            self._json = []
            self._ignore += 1
        elif tag in {"style", "noscript"}:
            self._ignore += 1
        if tag in {"p", "div", "li", "br", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "script" and self._ld:
            try:
                self.jsonld.append(json.loads("".join(self._json)))
            except (ValueError, TypeError):
                pass
            self._ld = False
        if tag in {"script", "style", "noscript"}:
            self._ignore = max(0, self._ignore - 1)

    def handle_data(self, data):
        if self._ld:
            self._json.append(data)
        if not self._ignore:
            self.parts.append(data)


def _objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from _objects(child)


_SHARED_HOSTS = {"greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com", "myworkdayjobs.com", "workday.com", "bamboohr.com", "icims.com", "jobvite.com", "recruitee.com", "applytojob.com", "linkedin.com", "facebook.com", "twitter.com", "x.com", "indeed.com", "glassdoor.com"}


def _company_url(value: str) -> str | None:
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme != "https" or not host or parsed.username or parsed.password or parsed.port not in {None, 443} or any(host == shared or host.endswith("." + shared) for shared in _SHARED_HOSTS):
            return None
        return parsed._replace(fragment="").geturl()
    except (TypeError, ValueError):
        return None


def _posting_objects(page: _Page, job: dict):
    for data in page.jsonld:
        for item in _objects(data):
            types = item.get("@type", [])
            if isinstance(types, str):
                types = [types]
            if "JobPosting" in types and str(item.get("title", "")).casefold().strip() == str(job.get("title", "")).casefold().strip():
                yield item


def _discover_company(page: _Page, job: dict) -> str | None:
    for item in _posting_objects(page, job):
        organization = item.get("hiringOrganization")
        organizations = organization if isinstance(organization, list) else [organization]
        for organization in organizations:
            if not isinstance(organization, dict):
                continue
            for key in ("url", "sameAs"):
                values = organization.get(key, [])
                values = values if isinstance(values, list) else [values]
                for value in values:
                    if isinstance(value, str) and (url := _company_url(value)):
                        return url
    return None


def _corporate_root(url: str) -> str | None:
    accepted = _company_url(url)
    if not accepted:
        return None
    parsed = urlsplit(accepted)
    host = parsed.hostname
    # Strip only an explicit careers label, rather than guessing a registrable
    # domain (which would mishandle suffixes such as .co.uk).
    for prefix in ("careers.", "career.", "jobs."):
        if host.startswith(prefix):
            host = host[len(prefix):]
            break
    return f"https://{host}/" if re.search(r"(?:^careers?\.|^jobs\.|/(?:careers?|jobs?)(?:/|$))", accepted, re.I) or host != parsed.hostname else None


def _salary_from_page(page: _Page, url: str, job: dict) -> list[dict]:
    results = []
    for data in page.jsonld:
        for item in _objects(data):
            types = item.get("@type", [])
            if isinstance(types, str):
                types = [types]
            if "JobPosting" not in types or not isinstance(item.get("baseSalary"), dict):
                continue
            try:
                if item.get("validThrough") and date.fromisoformat(str(item["validThrough"])[:10]) < date.today():
                    continue
            except ValueError:
                continue
            # Structured salary must belong to the displayed job, not a related
            # vacancy or an organization-wide pay range on the same page.
            if str(item.get("title", "")).casefold().strip() != str(job.get("title", "")).casefold().strip():
                continue
            base = item["baseSalary"]
            value = base.get("value") or {}
            if not isinstance(value, dict):
                continue
            low, high = value.get("minValue", value.get("value")), value.get("maxValue", value.get("value"))
            period = {"YEAR": "year", "MONTH": "month", "HOUR": "hour"}.get(str(value.get("unitText", "")).upper())
            if isinstance(low, (int, float)) and isinstance(high, (int, float)) and 0 < low <= high and period and re.fullmatch(r"[A-Z]{3}", str(base.get("currency", ""))):
                results.append({"kind": "employer_posted", "low": low, "high": high, "currency": base["currency"], "period": period, "location": job.get("location", ""), "role": job.get("title", ""), "source_url": url, "as_of": date.today().isoformat()})
    text = " ".join(page.parts)
    # Currency symbols alone are ambiguous (e.g. USD/CAD/AUD); require ISO code.
    matches = list(re.finditer(r"\b(USD|GBP|EUR|NGN|CAD|AUD|ZAR|INR|KES|GHS)\s*([\d,]+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(?:\1\s*)?([\d,]+(?:\.\d+)?)\s*(?:per\s+|/|a\s+)?(year|annum|annual|month|hour)\b", text, re.I))
    salary = matches[0] if len(matches) == 1 else None
    if salary:
        context = text[max(0, salary.start() - 500):salary.end() + 200]
        if str(job.get("title", "")).casefold() not in context.casefold() or re.search(r"\b(?:related|similar|recommended)\s+(?:jobs|vacancies|roles)\b", context, re.I):
            salary = None
    if salary:
        low, high = float(salary[2].replace(",", "")), float(salary[3].replace(",", ""))
        period = salary[4].lower()
        if 0 < low <= high:
            results.append({"kind": "employer_posted", "low": low, "high": high, "currency": salary[1].upper(), "period": "year" if period in {"annum", "annual"} else period, "location": job.get("location", ""), "role": job.get("title", ""), "source_url": url, "as_of": date.today().isoformat()})
    return results


def fetch_research(payload: dict, *, fetch=fetch_public_page) -> dict:
    """Inspect exact job plus at most one employer website; retain provenance.

    A deployment can supply market salary observations in `salaryEvidence` with
    an exact `excerpt`. This function rereads that source and verifies the quote;
    the planner separately checks role/location/experience/date/currency/period.
    This is not a web-wide salary search.
    """
    job = payload.get("job") or {}
    result = {"sources": [], "company_findings": [], "salary_evidence": [], "warnings": []}
    urls = list(dict.fromkeys(url for url in (job.get("url"), job.get("applyUrl")) if isinstance(url, str) and url))[:2]
    company_url = _company_url(job.get("companyWebsite", ""))
    discovered_from = None

    def inspect(url: str, *, posting: bool, provenance: str | None = None):
        try:
            response = fetch(url)
            parser = _Page()
            parser.feed(str(response["html"]))
            source = response.get("url", url)
            record = {"url": source, "accessed_at": date.today().isoformat(), "purpose": "selected vacancy" if posting else "employer public information"}
            if provenance:
                record["discovered_from"] = provenance
            result["sources"].append(record)
            if posting:
                # Keep original selected vacancy URL as the evidence identity.
                result["salary_evidence"].extend(_salary_from_page(parser, url, job))
            for raw in "".join(parser.parts).splitlines():
                line = re.sub(r"\s+", " ", raw).strip()
                if 45 <= len(line) <= 280 and re.search(r"\b(?:security|threat|risk|protect|compliance|vulnerabilit|incident)\w*\b", line, re.I):
                    result["company_findings"].append({"text": line, "source_url": source, "kind": "published_statement"})
                    break
            return parser
        except (ResearchError, ValueError, KeyError) as error:
            result["warnings"].append({"url": url, "message": str(error)[:180]})
            return None

    for url in urls:
        parser = inspect(url, posting=True)
        if not company_url and parser:
            company_url = _discover_company(parser, job)
            if company_url:
                discovered_from = url
    if not company_url:
        for url in urls:
            company_url = _corporate_root(url)
            if company_url:
                discovered_from = url
                break
    if company_url and company_url not in urls:
        inspect(company_url, posting=False, provenance=discovered_from)
    supplied = payload.get("salaryEvidence")
    if isinstance(supplied, list):
        for item in supplied[:3]:
            if not isinstance(item, dict) or item.get("kind") == "employer_posted":
                continue
            source, excerpt = item.get("source_url"), item.get("excerpt")
            if not isinstance(source, str) or not isinstance(excerpt, str) or not 40 <= len(excerpt) <= 1500:
                continue
            try:
                response = fetch(source)
                parser = _Page()
                parser.feed(str(response["html"]))
                visible = re.sub(r"\s+", " ", " ".join(parser.parts)).casefold()
                quote = re.sub(r"\s+", " ", excerpt).casefold()
                if quote not in visible:
                    continue
                required = [str(item.get(key, "")).casefold() for key in ("currency", "location", "role", "as_of")]
                amounts = [str(item.get(key, "")).replace(",", "") for key in ("low", "high")]
                if not all(value and value in quote for value in required) or not all(value and value in quote.replace(",", "") for value in amounts):
                    continue
                result["salary_evidence"].append(item | {"verified": True})
                result["sources"].append({"url": source, "accessed_at": date.today().isoformat(), "purpose": "salary observation quote verified"})
            except (ResearchError, ValueError, KeyError):
                continue
    return result
