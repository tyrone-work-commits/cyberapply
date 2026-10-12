"""Deterministic, explainable fit estimates; never estimates hiring probability."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from app.core.time import utcnow

SKILL_ALIASES = {
    "siem": ("siem", "security information and event management"),
    "splunk": ("splunk",),
    "microsoft sentinel": ("microsoft sentinel", "azure sentinel"),
    "incident response": ("incident response", "incident handling"),
    "threat hunting": ("threat hunting",),
    "threat intelligence": ("threat intelligence", "cyber threat intelligence"),
    "vulnerability management": ("vulnerability management",),
    "penetration testing": ("penetration testing", "pen testing", "pentesting"),
    "application security": ("application security", "appsec"),
    "cloud security": ("cloud security",),
    "network security": ("network security",),
    "identity and access management": ("identity and access management", "iam"),
    "endpoint detection and response": ("endpoint detection and response", "edr"),
    "zero trust": ("zero trust",),
    "python": ("python",),
    "powershell": ("powershell",),
    "linux": ("linux",),
    "aws": ("aws", "amazon web services"),
    "azure": ("azure", "microsoft azure"),
    "gcp": ("gcp", "google cloud platform"),
    "kubernetes": ("kubernetes", "k8s"),
    "docker": ("docker",),
    "terraform": ("terraform",),
    "nist": ("nist",),
    "iso 27001": ("iso 27001", "iso27001", "iso/iec 27001"),
    "soc 2": ("soc 2", "soc2"),
    "risk management": ("risk management",),
    "digital forensics": ("digital forensics", "computer forensics"),
    "secure coding": ("secure coding",),
    "devsecops": ("devsecops",),
    "cryptography": ("cryptography",),
    "owasp": ("owasp",),
    "burp suite": ("burp suite",),
    "wireshark": ("wireshark",),
    "nessus": ("nessus",),
    "qualys": ("qualys",),
    "crowdstrike": ("crowdstrike",),
    "firewalls": ("firewall", "firewalls"),
    "governance risk and compliance": ("governance risk and compliance", "grc"),
}

CERTIFICATION_ALIASES = {
    "cissp": ("cissp", "certified information systems security professional"),
    "cism": ("cism", "certified information security manager"),
    "cisa": ("cisa", "certified information systems auditor"),
    "comptia security+": ("security+", "comptia security+"),
    "comptia cysa+": ("cysa+", "comptia cysa+"),
    "comptia pentest+": ("pentest+", "comptia pentest+"),
    "oscp": ("oscp", "offensive security certified professional"),
    "ceh": ("ceh", "certified ethical hacker"),
    "ccsp": ("ccsp", "certified cloud security professional"),
    "gcih": ("gcih",),
    "gsec": ("gsec",),
    "gcia": ("gcia",),
    "aws certified security specialty": ("aws certified security specialty", "aws certified security - specialty"),
}


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", str(value).strip().casefold())


def _canonical(value: str, catalog: dict[str, tuple[str, ...]]) -> str:
    normalized = normalize(value)
    for canonical, aliases in catalog.items():
        if normalized in aliases:
            return canonical
    return normalized


def _mentions(text: str, phrase: str) -> bool:
    return bool(re.search(r"(?<![\w])" + re.escape(phrase) + r"(?![\w])", text, flags=re.I))


def detect_skills(text: str) -> list[str]:
    """Return textual mentions for user review, not verified candidate abilities."""
    return [name for name, aliases in SKILL_ALIASES.items() if any(_mentions(text, alias) for alias in aliases)]


def detect_certifications(text: str) -> list[str]:
    """Return textual mentions; a mention does not assert a held credential."""
    return [name for name, aliases in CERTIFICATION_ALIASES.items() if any(_mentions(text, alias) for alias in aliases)]


def is_cybersecurity_job(title: str, description: str = "") -> bool:
    text = normalize(f"{title}\n{description}")
    patterns = (
        r"\bcyber\s*security\b", r"\binformation security\b", r"\bapplication security\b",
        r"\bcloud security\b", r"\bnetwork security\b", r"\bsecurity (?:engineer|analyst|architect|consultant)\b",
        r"\bsoc (?:analyst|engineer)\b", r"\bpenetration test", r"\bthreat (?:hunt|intelligence)",
        r"\bincident response\b", r"\bdevsecops\b", r"\bciso\b", r"\bgrc\b",
        r"\bidentity and access management\b", r"\bvulnerability management\b",
    )
    return any(re.search(pattern, text) for pattern in patterns)


def _data(value: Any) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        nested = value.get("data")
        return nested if isinstance(nested, dict) else value
    return getattr(value, "data", {}) or {}


def _field(value: Any, key: str, default: Any = None) -> Any:
    return value.get(key, default) if isinstance(value, dict) else getattr(value, key, default)


def _terms(value: Any, catalog: dict[str, tuple[str, ...]]) -> set[str]:
    return {_canonical(item, catalog) for item in (value or []) if isinstance(item, str) and item.strip()}


def compute_match(job: Any, profile: Any, preferences: Any) -> dict:
    """Match explicit candidate data against job fields, preserving unknown eligibility.

    Required skills from imported public listings are description mentions and are
    labelled accordingly. Only structured mandatory_eligibility fields gate eligibility.
    Missing skills and certifications remain visible rather than being invented.
    """
    person, prefs = _data(profile), _data(preferences)
    required = _terms(_field(job, "required_skills", []), SKILL_ALIASES)
    held = _terms(person.get("skills"), SKILL_ALIASES)
    certs = _terms(_field(job, "required_certifications", []), CERTIFICATION_ALIASES)
    held_certs = _terms(person.get("certifications"), CERTIFICATION_ALIASES)
    matched, missing = sorted(required & held), sorted(required - held)
    matched_certs, missing_certs = sorted(certs & held_certs), sorted(certs - held_certs)
    attributes = _field(job, "attributes", {}) or {}
    eligibility = attributes.get("mandatory_eligibility", {}) or {}
    checks: list[dict] = []
    blockers: list[str] = []
    reasons: list[str] = []

    def check(name: str, result: bool | None, explanation: str) -> None:
        status = "met" if result is True else "not_met" if result is False else "unknown"
        checks.append({"requirement": name, "status": status, "reason": explanation})
        if result is not True:
            blockers.append(explanation)

    country = eligibility.get("work_authorization_country")
    if country:
        authorizations = person.get("work_authorization") or {}
        value = next((value for key, value in authorizations.items() if normalize(key) == normalize(country)), None)
        check("work_authorization", value if isinstance(value, bool) else None,
              f"Work authorization for {country}: " + ("confirmed" if value is True else "not authorized" if value is False else "requires the user's confirmation"))
    citizenship = eligibility.get("citizenship_country")
    if citizenship:
        declared = person.get("citizenships")
        value = normalize(citizenship) in {normalize(x) for x in declared} if declared else None
        check("citizenship", value, f"Citizenship requirement for {citizenship}: " + ("met" if value else "requires review"))
    required_clearance = eligibility.get("security_clearance")
    if required_clearance and required_clearance != "none":
        rank = {"none": 0, "public_trust": 1, "confidential": 2, "secret": 3, "top_secret": 4, "ts_sci": 5}
        declared = person.get("security_clearance")
        # Public trust is not a clearance and cannot satisfy a classified clearance.
        result = None if declared is None else (declared == required_clearance if required_clearance == "public_trust" else rank.get(declared, 0) >= rank.get(required_clearance, 99))
        check("security_clearance", result, f"Required {required_clearance} clearance/status: " + ("declared by user" if result else "missing or unconfirmed"))
    minimum = eligibility.get("minimum_years_experience")
    if minimum is not None:
        experience = person.get("years_experience")
        result = None if experience is None else experience >= minimum
        check("years_experience", result, f"Minimum {minimum:g} years of experience: " + ("met from user data" if result else "missing or below minimum"))
    if eligibility.get("sponsorship_available") is False:
        needs_sponsorship = person.get("sponsorship_required")
        check("sponsorship", None if needs_sponsorship is None else not needs_sponsorship,
              "Employer does not provide sponsorship: " + ("user confirms none needed" if needs_sponsorship is False else "requires review"))
    if not _field(job, "active", True):
        blockers.append("Job is inactive.")
    expires_at = _field(job, "expires_at")
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except ValueError:
            expires_at = None
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is not None:
            expires_at = expires_at.astimezone(timezone.utc).replace(tzinfo=None)
        if expires_at <= utcnow():
            blockers.append("Job has expired.")
    if _field(profile, "confirmed", True) is False:
        blockers.append("Candidate profile requires user confirmation.")
    if missing_certs:
        blockers.append("Required certifications are missing: " + ", ".join(missing_certs))

    skill_ratio = len(matched) / len(required) if required else 0.5
    cert_ratio = len(matched_certs) / len(certs) if certs else 0.5
    title = normalize(_field(job, "title", ""))
    roles = prefs.get("roles") or []
    role_match = bool(title) and any(normalize(role) in title or title in normalize(role) for role in roles) if roles else None
    role_ratio = 1.0 if role_match is True else 0.0 if role_match is False else 0.5
    preference_checks: list[dict] = []

    def preference(name: str, result: bool | None, explanation: str) -> None:
        preference_checks.append({"preference": name, "matches": result, "reason": explanation})

    if roles:
        preference("role", role_match, "Job title compared with preferred roles.")
    work_modes = prefs.get("work_modes") or ([] if not prefs.get("remote_only") else ["remote"])
    actual_mode = attributes.get("workplace_type") or ("remote" if _field(job, "remote", False) else "unspecified")
    if work_modes:
        preference("work_mode", None if actual_mode == "unspecified" else actual_mode in work_modes, f"Job work mode: {actual_mode}.")
    locations = prefs.get("locations") or []
    if locations:
        location = normalize(_field(job, "location", ""))
        preference("location", any(normalize(item) in location for item in locations) if location else None, "Location compared with preferred locations.")
    countries = prefs.get("countries") or []
    if countries:
        job_country = attributes.get("country")
        preference("country", normalize(job_country) in {normalize(x) for x in countries} if job_country else None, "Country is compared only when the listing supplies it.")
    for preference_key, field in (("employment_types", "employment_type"), ("levels", "level")):
        choices = prefs.get(preference_key) or []
        if choices:
            actual = _field(job, field)
            preference(preference_key, normalize(actual) in {normalize(x) for x in choices} if actual else None, f"Listing {field}: {actual or 'not supplied'}.")
    if prefs.get("min_salary") is not None:
        maximum = _field(job, "salary_max")
        currency = _field(job, "currency", "USD")
        comparable = maximum is not None and currency == prefs.get("currency", "USD") and attributes.get("salary_interval", "year") == "year"
        preference("salary", maximum >= prefs["min_salary"] if comparable else None, "Annual salary is compared only with a known range in the same currency.")
    excluded = {normalize(value) for value in prefs.get("excluded_companies", [])}
    if normalize(_field(job, "company", "")) in excluded:
        blockers.append("Company is excluded by the user's preferences.")
    job_text = normalize(f"{_field(job, 'title', '')}\n{_field(job, 'description', '')}")
    if prefs.get("keywords"):
        preference("keywords", any(_mentions(job_text, normalize(keyword)) for keyword in prefs["keywords"]), "Listing compared with desired keywords.")
    for keyword in prefs.get("exclude_keywords", []):
        if _mentions(job_text, normalize(keyword)):
            blockers.append(f"Listing includes excluded keyword: {keyword}.")
    pref_ratio = sum(1 if x["matches"] is True else 0 if x["matches"] is False else 0.5 for x in preference_checks) / len(preference_checks) if preference_checks else 0.5
    score = round(60 * skill_ratio + 15 * cert_ratio + 15 * role_ratio + 10 * pref_ratio)
    basis = attributes.get("skills_basis", "user_supplied_requirements")
    if required:
        reasons.append(f"{len(matched)} of {len(required)} listed skills match the user's declared skills.")
    else:
        reasons.append("No structured skill requirements are available; skill fit is unknown.")
    if basis == "job_description_mentions":
        reasons.append("Imported skills are textual mentions, not confirmed mandatory requirements.")
    if certs:
        reasons.append(f"{len(matched_certs)} of {len(certs)} required certifications match user data.")
    if roles:
        reasons.append("Job title matches a preferred role." if role_match else "Job title does not match a preferred role.")
    reasons.append("This is an explainable heuristic fit score, not a hiring probability or an ATS score.")
    return {
        "score": score, "score_kind": "heuristic_fit", "eligible": not blockers,
        "matched_skills": matched, "missing_skills": missing,
        "matched_certifications": matched_certs, "missing_certifications": missing_certs,
        "reasons": reasons, "blockers": blockers, "eligibility_checks": checks,
        "preference_checks": preference_checks, "skills_basis": basis,
        "automatic_preference_eligible": all(item["matches"] is True for item in preference_checks),
        "components": {"skills": round(skill_ratio * 60, 2), "certifications": round(cert_ratio * 15, 2), "role": round(role_ratio * 15, 2), "preferences": round(pref_ratio * 10, 2)},
    }
