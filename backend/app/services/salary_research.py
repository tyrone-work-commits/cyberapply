"""Salary suggestions from the exact employer's public, structured job posting.

No candidate salary preference can be inferred from a CV. This module uses only
an explicitly advertised range and returns no answer when that evidence is
absent, ambiguous, or for a different vacancy.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx


@dataclass(frozen=True)
class SalaryProposal:
    answer: str
    source_url: str


_INTERVALS = {
    "per-year-salary": "year",
    "per-month-salary": "month",
    "per-hour-wage": "hour",
}


def _posting_path(url: str, board: str, posting_id: str, region: str) -> bool:
    try:
        parsed = urlsplit(url)
    except (TypeError, ValueError):
        return False
    host = "jobs.eu.lever.co" if region == "eu" else "jobs.lever.co"
    return (parsed.scheme == "https" and parsed.hostname == host
            and not parsed.username and not parsed.password and not parsed.port
            and parsed.path.rstrip("/") in {f"/{board}/{posting_id}", f"/{board}/{posting_id}/apply"})


def research_salary(job: dict, *, total_experience_years: float | None = None,
                    cybersecurity_experience_years: float | None = None,
                    get=httpx.get) -> SalaryProposal | None:
    """Look up a Lever vacancy's published pay without exposing agent credentials.

    A separate, unauthenticated HTTP call is used for the public feed. We do
    not estimate pay from unrelated locations, guessed experience, or a CV.
    """
    source = job.get("source") or {}
    if not isinstance(source, dict) or source.get("provider") != "lever":
        return None
    board, posting_id, region = source.get("board"), source.get("externalId"), source.get("region")
    if (not isinstance(board, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", board)
            or not isinstance(posting_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,100}", posting_id)
            or region not in {"global", "eu"}
            or not _posting_path(job.get("applyUrl", ""), board, posting_id, region)):
        return None
    host = "api.eu.lever.co" if region == "eu" else "api.lever.co"
    api_url = f"https://{host}/v0/postings/{board}/{posting_id}"
    try:
        response = get(api_url, headers={"Accept": "application/json"}, timeout=10, follow_redirects=False)
        response.raise_for_status()
        if len(response.content) > 500_000:
            return None
        posting = response.json()
    except (httpx.HTTPError, ValueError, TypeError):
        return None
    if not isinstance(posting, dict) or posting.get("id") != posting_id:
        return None
    if str(posting.get("text") or "").casefold().strip() != str(job.get("title", "")).casefold().strip():
        return None
    if not _posting_path(posting.get("applyUrl", ""), board, posting_id, region):
        return None
    pay = posting.get("salaryRange")
    if not isinstance(pay, dict):
        return None
    currency, interval = pay.get("currency"), _INTERVALS.get(pay.get("interval"))
    minimum, maximum = pay.get("min"), pay.get("max")
    if (not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency)
            or not interval or isinstance(minimum, bool) or isinstance(maximum, bool)
            or not isinstance(minimum, (int, float)) or not isinstance(maximum, (int, float))
            or not math.isfinite(minimum) or not math.isfinite(maximum)
            or minimum <= 0 or maximum < minimum or maximum > minimum * 5):
        return None
    # With at most three total/relevant years, suggest the lower half of the
    # employer's published band. This is a transparent positioning heuristic,
    # not a claim that all three years were in cybersecurity or a personal floor.
    early_career = any(isinstance(value, (int, float)) and not isinstance(value, bool)
                       and math.isfinite(value) and 0 <= value <= 3
                       for value in (total_experience_years, cybersecurity_experience_years))
    if early_career and maximum > minimum:
        maximum = minimum + (maximum - minimum) / 2
    def amount(value: float) -> str:
        return f"{value:,.0f}" if float(value).is_integer() else f"{value:,.2f}"
    answer = (f"I am seeking {currency} {amount(minimum)}–{amount(maximum)} per {interval}, "
              "within the range advertised for this role; open to discussing the full package.")
    return SalaryProposal(answer=answer, source_url=posting["applyUrl"])


def answer_salary_question(question: str, proposal: SalaryProposal | None) -> str | None:
    """Use advertised pay for an open-text expectation, never salary history."""
    if proposal is None or not isinstance(question, str):
        return None
    normalized = re.sub(r"\s+", " ", question).strip().lower()
    if len(normalized) > 240 or not re.search(r"\b(salary|compensation|pay)\b", normalized):
        return None
    if re.search(r"\b(current|previous|past|last|history|earned|earning|minimum|lowest|required)\b", normalized):
        return None
    if not re.search(r"\b(expect|desired|seeking|looking for|target)\w*\b", normalized):
        return None
    # Never silently convert pay periods or currencies for a differently
    # worded question. A mismatch needs candidate review.
    answer = proposal.answer.lower()
    periods = {"annual": "year", "yearly": "year", "monthly": "month", "hourly": "hour"}
    if any(word in normalized and f"per {period}" not in answer for word, period in periods.items()):
        return None
    mentioned = re.findall(r"\b(?:USD|GBP|EUR|NGN|CAD|AUD|INR)\b", question.upper())
    if mentioned and mentioned[0].lower() not in answer:
        return None
    return proposal.answer
