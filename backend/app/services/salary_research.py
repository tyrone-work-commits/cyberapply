"""Employer-advertised salary suggestions and reviewed current-pay conversion.

Expected pay comes only from the exact employer's public posting. Current pay
comes only from candidate-entered facts, never an inference from a CV.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import urlsplit

import httpx


@dataclass(frozen=True)
class SalaryProposal:
    answer: str
    source_url: str
    currency: str | None = None
    period: str | None = None


_INTERVALS = {
    "per-year-salary": "year",
    "per-year": "year",
    "per-month-salary": "month",
    "per-month": "month",
    "per-hour-wage": "hour",
    "per-hour": "hour",
}
_CURRENCIES = {"USD", "NGN", "GBP", "EUR", "CAD", "AUD", "GHS", "KES", "ZAR", "AED", "INR", "SGD"}


def format_current_salary(facts: dict | None) -> str | None:
    """Format only a candidate-entered amount with explicit currency and period."""
    if not isinstance(facts, dict):
        return None
    amount, currency, period = facts.get("amount"), facts.get("currency"), facts.get("period")
    if (isinstance(amount, bool) or not isinstance(amount, (int, float))
            or not math.isfinite(amount) or not 0 < amount <= 1_000_000_000_000
            or not isinstance(currency, str) or currency not in _CURRENCIES
            or not isinstance(period, str) or period not in {"year", "month", "hour"}):
        return None
    value = f"{amount:,.0f}" if float(amount).is_integer() else f"{amount:,.2f}"
    return f"{currency} {value} per {period}"


_QUESTION_PERIODS = {
    "year": (r"\b(?:annual|annually|yearly|per year|a year)\b",),
    "month": (r"\b(?:monthly|per month|a month)\b",),
    "hour": (r"\b(?:hourly|per hour|an hour)\b",),
}


def _current_pay_question(question: str, facts: dict | None) -> tuple[str, str | None] | None:
    if format_current_salary(facts) is None or not isinstance(question, str):
        return None
    normalized = re.sub(r"\s+", " ", question).strip().lower()
    if len(normalized) > 240 or not re.search(r"\b(current|present)\b", normalized):
        return None
    if not re.search(r"\b(salary|compensation|pay)\b", normalized):
        return None
    if re.search(r"\b(expect|desired|seeking|target|previous|past|last|minimum|lowest)\w*\b", normalized):
        return None
    periods = {period for period, patterns in _QUESTION_PERIODS.items()
               if any(re.search(pattern, normalized) for pattern in patterns)}
    if len(periods) > 1:
        return None
    mentioned = re.findall(r"\b(?:USD|NGN|GBP|EUR|CAD|AUD|GHS|KES|ZAR|AED|INR|SGD)\b", question.upper())
    if mentioned and (len(set(mentioned)) > 1 or mentioned[0] != facts["currency"]):
        return None
    return normalized, next(iter(periods)) if periods else None


def _current_amount(facts: dict, target_period: str) -> Decimal | None:
    source_period = facts["period"]
    amount = Decimal(str(facts["amount"]))
    if source_period == target_period:
        return amount
    if {source_period, target_period} != {"month", "year"}:
        return None  # Hourly conversion needs an explicit hours-per-week fact.
    converted = amount * 12 if source_period == "month" else amount / 12
    converted = converted.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return converted if converted <= Decimal("1000000000000") else None


def _money(amount: Decimal) -> str:
    return f"{amount:,.0f}" if amount == amount.to_integral_value() else f"{amount:,.2f}"


def answer_current_salary_question(question: str, facts: dict | None,
                                   proposal: SalaryProposal | None = None) -> str | None:
    """Convert reviewed current pay between month and year when the form requests it."""
    parsed = _current_pay_question(question, facts)
    if parsed is None:
        return None
    _normalized, requested_period = parsed
    original = format_current_salary(facts)
    target_period = requested_period
    if target_period is None and proposal and proposal.currency == facts["currency"]:
        target_period = proposal.period if proposal.period in {"month", "year"} else None
    if target_period is None or target_period == facts["period"]:
        return original
    converted = _current_amount(facts, target_period)
    if converted is None:
        return None if requested_period else original
    return (f"{facts['currency']} {_money(converted)} per {target_period} "
            f"(converted from {original})")


def answer_current_salary_number_question(question: str, facts: dict | None) -> str | None:
    """A numeric field is safe only with an explicit currency and pay period."""
    parsed = _current_pay_question(question, facts)
    if parsed is None or parsed[1] is None or facts["currency"] not in question.upper():
        return None
    amount = _current_amount(facts, parsed[1])
    if amount is None:
        return None
    return f"{amount:.0f}" if amount == amount.to_integral_value() else f"{amount:.2f}"


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
    return SalaryProposal(answer=answer, source_url=posting["applyUrl"], currency=currency, period=interval)


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
