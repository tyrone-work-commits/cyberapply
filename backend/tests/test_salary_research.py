"""Salary research uses only the exact employer's public pay disclosure."""

from app.services.salary_research import (
    SalaryProposal,
    answer_current_salary_number_question,
    answer_current_salary_question,
    answer_salary_question,
    format_current_salary,
    research_salary,
)

JOB = {
    "title": "Security Analyst",
    "applyUrl": "https://jobs.lever.co/example/1234/apply",
    "source": {"provider": "lever", "board": "example", "externalId": "1234", "region": "global"},
}


class Response:
    content = b"{}"

    def __init__(self, salary=None, **changes):
        self.payload = {
            "id": "1234", "text": "Security Analyst",
            "applyUrl": "https://jobs.lever.co/example/1234/apply",
            "salaryRange": salary or {"currency": "NGN", "interval": "per-month-salary", "min": 200000, "max": 300000},
            **changes,
        }

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def test_exact_public_salary_range_answers_expectation_without_claiming_experience():
    calls = []

    def fetch(url, **kwargs):
        calls.append((url, kwargs))
        return Response()

    proposal = research_salary(JOB, get=fetch)
    assert proposal.source_url == JOB["applyUrl"]
    assert "NGN 200,000–300,000 per month" in proposal.answer
    assert "experience" not in proposal.answer.lower()
    assert answer_salary_question("What salary do you expect?", proposal) == proposal.answer
    assert calls == [("https://api.lever.co/v0/postings/example/1234", {
        "headers": {"Accept": "application/json"}, "timeout": 10, "follow_redirects": False,
    })]

    early = research_salary(JOB, total_experience_years=3, get=fetch)
    assert "NGN 200,000–250,000 per month" in early.answer
    assert "cybersecurity experience" not in early.answer.lower()

    annual = research_salary(JOB, get=lambda *_a, **_k: Response(
        salaryRange={"currency": "NGN", "interval": "per-year", "min": 2400000, "max": 3600000}))
    assert annual.period == "year" and annual.currency == "NGN"


def test_rejects_mismatched_job_and_unsupported_pay():
    assert research_salary({**JOB, "applyUrl": "https://example.org/apply"}, get=lambda *_a, **_k: Response()) is None
    assert research_salary(JOB, get=lambda *_a, **_k: Response(id="other")) is None
    assert research_salary(JOB, get=lambda *_a, **_k: Response(salaryRange=None)) is None
    assert research_salary(JOB, get=lambda *_a, **_k: Response(salaryRange={"currency": "NGN", "interval": "per-year-salary", "min": 0, "max": 300000})) is None


def test_salary_history_personal_floor_and_mismatched_units_still_need_review():
    proposal = research_salary(JOB, get=lambda *_a, **_k: Response())
    assert answer_salary_question("What is your current salary?", proposal) is None
    assert answer_salary_question("What is the lowest salary you would accept?", proposal) is None
    assert answer_salary_question("What is your expected annual salary?", proposal) is None
    assert answer_salary_question("What is your expected USD salary?", proposal) is None


def test_current_salary_uses_only_explicit_reviewed_candidate_fact():
    facts = {"amount": 125000, "currency": "USD", "period": "year"}
    assert format_current_salary(facts) == "USD 125,000 per year"
    assert answer_current_salary_question("What is your current salary?", facts) == "USD 125,000 per year"
    assert answer_current_salary_question("What is your expected salary?", facts) is None
    assert answer_current_salary_question("What is your current monthly salary?", facts) == (
        "USD 10,416.67 per month (converted from USD 125,000 per year)")
    assert answer_current_salary_question("What is your current NGN salary?", facts) is None
    assert answer_current_salary_question("What is your previous salary?", facts) is None
    assert answer_current_salary_question("What is your current salary?", None) is None
    assert format_current_salary({"amount": 125000, "currency": [], "period": "year"}) is None


def test_monthly_current_pay_converts_to_annual_without_changing_currency():
    facts = {"amount": 5000, "currency": "USD", "period": "month"}
    converted = "USD 60,000 per year (converted from USD 5,000 per month)"
    assert answer_current_salary_question("Current annual salary (USD)", facts) == converted
    annual_job = SalaryProposal("Expected pay", "https://example.test/job", currency="USD", period="year")
    assert answer_current_salary_question("What is your current salary?", facts, annual_job) == converted
    other_currency = SalaryProposal("Expected pay", "https://example.test/job", currency="NGN", period="year")
    assert answer_current_salary_question("What is your current salary?", facts, other_currency) == "USD 5,000 per month"
    assert answer_current_salary_number_question("Current annual salary (USD)", facts) == "60000"
    assert answer_current_salary_number_question("Current annual salary", facts) is None
    assert answer_current_salary_question("Current USD annual or monthly salary", facts) is None


def test_hourly_pay_needs_hours_fact_for_annual_conversion():
    facts = {"amount": 35, "currency": "USD", "period": "hour"}
    assert answer_current_salary_question("Current annual salary (USD)", facts) is None
    assert answer_current_salary_number_question("Current annual salary (USD)", facts) is None
