"""Salary research uses only the exact employer's public pay disclosure."""

from app.services.salary_research import answer_salary_question, research_salary

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
