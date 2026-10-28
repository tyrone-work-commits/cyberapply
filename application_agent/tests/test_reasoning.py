from datetime import date
import unittest
from unittest.mock import patch

from application_agent.reasoning import build_plan, cybersecurity_experience
from application_agent.research import ResearchError, _target, fetch_research


CV = """TYRONE EKHATOR
tyrone@example.test
+234 800 123 4567
Location: Lagos, Nigeria
https://github.com/tyrone/example
Experience
Software Engineer | Jan 2020 - Dec 2022
Built web applications with Python and SQL.
Cybersecurity Analyst | Jan 2023 - Dec 2023
Monitored security alerts using Splunk and supported incident response.
SOC Analyst | Jul 2023 - Dec 2024
Investigated SIEM alerts and assessed network security risks.
Education
BSc Cybersecurity | Jan 2016 - Dec 2019
Skills
Python, Splunk, SIEM, incident response
"""
JOB = {"title": "Cybersecurity Analyst", "company": "Example", "description": "Monitor security alerts in Splunk and support incident response.", "location": "Lagos, Nigeria", "url": "https://employer.example/jobs/123"}


def field(label, kind="text", required=True, options=None):
    return {"id": label, "label": label, "type": kind, "required": required, "options": options or []}


class PlanningTests(unittest.TestCase):
    def plan(self, fields, research=None, cv=CV):
        return build_plan({"job": JOB, "cv": {"text": cv}}, fields, research)

    def test_security_duration_merges_overlap_and_excludes_software_and_degree(self):
        result = cybersecurity_experience(CV, date(2026, 10, 28))
        self.assertEqual(result["months"], 24)
        self.assertEqual(result["years"], 2)
        self.assertEqual(len(result["evidence"]), 2)
        self.assertFalse(result["approximate"])

    def test_undated_security_skill_is_not_three_years_of_experience(self):
        result = self.plan([field("How many years of cybersecurity experience do you have?", "number")], cv="Example Person\nSoftware Engineer\nSkills: cybersecurity, Python\nThree years total experience")
        self.assertFalse(result["experience"]["established"])
        self.assertEqual(result["answers"], [])
        self.assertEqual(len(result["unresolved"]), 1)

    def test_year_only_dates_are_conservative_and_flagged(self):
        result = cybersecurity_experience("Experience\nSecurity Analyst | 2020 - 2023", date(2026, 10, 28))
        self.assertEqual(result["months"], 24)
        self.assertTrue(result["approximate"])

    def test_future_role_is_not_counted(self):
        result = cybersecurity_experience("Experience\nSecurity Analyst | Jan 2027 - Dec 2029", date(2026, 10, 28))
        self.assertFalse(result["established"])

    def test_identity_comes_from_cv(self):
        result = self.plan([field("Full name"), field("Email address"), field("Location"), field("GitHub repository")])
        values = {answer["field_id"]: answer["value"] for answer in result["answers"]}
        self.assertEqual(values["Full name"], "TYRONE EKHATOR")
        self.assertEqual(values["Email address"], "tyrone@example.test")
        self.assertEqual(values["Location"], "Lagos, Nigeria")
        self.assertEqual(values["GitHub repository"], "https://github.com/tyrone/example")
        self.assertFalse(result["unresolved"])

    def test_missing_eligibility_and_consent_remain_unanswered(self):
        fields = [field("Are you authorized to work in the UK?"), field("I agree to privacy terms", "checkbox"), field("Current salary in USD per year", "number"), field("Gender", "select", options=["Male", "Female", "Prefer not to say"])]
        result = self.plan(fields)
        self.assertFalse(result["answers"])
        self.assertEqual(len(result["unresolved"]), 4)

    def test_generated_motivation_is_proposed_contribution_and_cv_grounded(self):
        result = self.plan([field("Why are you interested in this role?", "textarea"), field("Cover letter", "textarea")], {"company_findings": [{"text": "Protect customer systems against phishing threats", "source_url": "https://employer.example/about"}]})
        self.assertEqual(len(result["answers"]), 2)
        self.assertIn("I would bring", result["answers"][0]["value"])
        self.assertIn("Splunk", result["cover_letter"])
        self.assertNotIn("three years", result["cover_letter"])

    def test_numeric_years_answer_is_traceable(self):
        result = self.plan([field("Years of cybersecurity experience", "number")])
        self.assertEqual(result["answers"][0]["value"], "2.0")
        self.assertIn("SOC Analyst", result["answers"][0]["evidence"])

    def test_salary_midpoint_and_month_to_year_conversion(self):
        evidence = {"kind": "employer_posted", "low": 1000, "high": 2000, "currency": "USD", "period": "month", "location": JOB["location"], "source_url": JOB["url"]}
        result = self.plan([field("Expected annual salary in USD", "number")], {"salary_evidence": [evidence]})
        self.assertEqual(result["answers"][0]["value"], "18000")
        self.assertEqual(result["answers"][0]["source"], "salary_research")

    def test_salary_unknown_currency_or_geography_pauses(self):
        evidence = {"kind": "employer_posted", "low": 1000, "high": 2000, "currency": "USD", "period": "month", "location": "New York, USA", "source_url": JOB["url"]}
        result = self.plan([field("Expected annual salary in USD", "number")], {"salary_evidence": [evidence]})
        self.assertFalse(result["answers"])
        self.assertEqual(len(result["unresolved"]), 1)

    def test_market_salary_requires_matching_experience_date_and_role(self):
        evidence = {"kind": "market", "low": 12000, "high": 18000, "currency": "USD", "period": "year", "location": JOB["location"], "source_url": "https://salary.example/report", "role": JOB["title"], "min_years": 1, "max_years": 3, "as_of": date.today().isoformat(), "verified": True}
        good = self.plan([field("Expected salary")], {"salary_evidence": [evidence]})
        self.assertEqual(good["answers"][0]["value"], "USD 15000 per year")
        for changed in ({"as_of": "2020-01-01"}, {"max_years": 1}, {"role": "Software Engineer"}, {"currency": ""}, {"verified": False}):
            with self.subTest(changed=changed):
                self.assertFalse(self.plan([field("Expected salary")], {"salary_evidence": [evidence | changed]})["answers"])

    def test_exact_select_match_only(self):
        result = self.plan([field("Location", "select", options=["UK", "US"])])
        self.assertEqual(result["answers"], [])
        self.assertEqual(len(result["unresolved"]), 1)

    def test_required_file_delegates_to_runner(self):
        result = self.plan([field("Resume", "file")])
        self.assertEqual(result["answers"], [])
        self.assertIn("upload the selected CV", result["unresolved"][0]["reason"])

    def test_specific_missing_skill_is_not_invented_in_experience_answer(self):
        result = self.plan([field("Describe your experience with Kubernetes", "textarea")])
        self.assertFalse(result["answers"])
        self.assertEqual(len(result["unresolved"]), 1)

    def test_exact_user_confirmed_eligibility_is_used_with_original_evidence(self):
        question = "Are you authorized to work in Nigeria?"
        payload = {"job": JOB, "cv": {"text": CV}, "confirmedAnswers": [{"question": question, "value": "Yes"}]}
        result = build_plan(payload, [field(question, "select", options=["Yes", "No"])])
        self.assertEqual(result["answers"][0]["value"], "Yes")
        self.assertEqual(result["answers"][0]["source"], "user_confirmed")
        self.assertIn(question, result["answers"][0]["evidence"])
        self.assertIn("User confirmed answer: Yes", result["answers"][0]["evidence"])
        self.assertFalse(result["unresolved"])

    def test_confirmation_does_not_transfer_to_similar_consent_or_unrelated_question(self):
        original = "I agree to Example storing my application."
        fields = [field("I agree to Example storing and sharing my application.", "checkbox"), field("Are you authorized to work in the UK?")]
        result = build_plan({"job": JOB, "cv": {"text": CV}, "confirmedAnswers": [{"question": original, "value": "I agree"}, {"question": "Are you authorized to work in Nigeria?", "value": "Yes"}]}, fields)
        self.assertFalse(result["answers"])
        self.assertEqual(len(result["unresolved"]), 2)

    def test_explicit_checkbox_affirmative_requires_exact_statement(self):
        question = "I agree to Example storing my application."
        for answer in ("yes", "true", "I agree"):
            with self.subTest(answer=answer):
                result = build_plan({"confirmedAnswers": [{"question": question, "value": answer}]}, [field(question, "checkbox")])
                self.assertEqual(result["answers"][0]["value"], "true")
                self.assertEqual(result["answers"][0]["source"], "user_confirmed")
        result = build_plan({"confirmedAnswers": [{"question": question, "value": "No"}]}, [field(question, "checkbox")])
        self.assertFalse(result["answers"])
        self.assertEqual(len(result["unresolved"]), 1)

    def test_confirmed_radio_select_options_must_match_exactly(self):
        question = "Are you authorized to work here?"
        for kind in ("radio", "select"):
            for value, count in (("Yes", 1), ("yes", 0), ("Yes, always", 0)):
                with self.subTest(kind=kind, value=value):
                    result = build_plan({"confirmedAnswers": [{"question": question, "value": value}]}, [field(question, kind, options=["Yes", "No"])])
                    self.assertEqual(len(result["answers"]), count)

    def test_optional_unknown_or_blank_confirmations_have_no_default(self):
        question = "I agree to receive marketing emails."
        result = build_plan({"confirmedAnswers": [{"question": question, "value": ""}]}, [field(question, "checkbox", required=False), field("Gender", "select", required=False, options=["Male", "Female"])])
        self.assertFalse(result["answers"])
        self.assertFalse(result["unresolved"])

    def test_conflicting_exact_confirmations_pause_instead_of_guessing(self):
        question = "Are you authorized to work here?"
        result = build_plan({"confirmedAnswers": [{"question": question, "value": "Yes"}, {"question": question, "value": "No"}]}, [field(question, "select", options=["Yes", "No"])])
        self.assertFalse(result["answers"])
        self.assertIn("Conflicting", result["unresolved"][0]["reason"])


class ResearchTests(unittest.TestCase):
    def test_private_and_mixed_dns_are_rejected(self):
        for addresses in (["127.0.0.1"], ["8.8.8.8", "10.0.0.1"], ["::1"]):
            with self.subTest(addresses=addresses), patch("application_agent.research.socket.getaddrinfo", return_value=[(2, 1, 6, "", (address, 443)) for address in addresses]):
                with self.assertRaises(ResearchError):
                    _target("https://employer.example/jobs/1")

    def test_public_https_only(self):
        for url in ("http://employer.example", "https://user:secret@employer.example", "https://localhost", "https://employer.example:8443"):
            with self.subTest(url=url), self.assertRaises(ResearchError):
                _target(url)

    def test_structured_salary_and_company_findings_keep_sources(self):
        html = '<script type="application/ld+json">{"@type":"JobPosting","title":"Cybersecurity Analyst","baseSalary":{"currency":"NGN","value":{"minValue":100000,"maxValue":300000,"unitText":"MONTH"}}}</script><p>Protect our customers through threat detection and security monitoring.</p>'
        result = fetch_research({"job": JOB}, fetch=lambda url: {"url": url, "html": html})
        self.assertEqual(result["salary_evidence"][0]["currency"], "NGN")
        self.assertEqual(result["salary_evidence"][0]["period"], "month")
        self.assertEqual(result["company_findings"][0]["source_url"], JOB["url"])

    def test_other_vacancy_salary_is_ignored(self):
        html = '<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer","baseSalary":{"currency":"USD","value":{"value":100000,"unitText":"YEAR"}}}</script>'
        result = fetch_research({"job": JOB}, fetch=lambda url: {"url": url, "html": html})
        self.assertFalse(result["salary_evidence"])

    def test_research_failure_is_missing_evidence(self):
        def fail(_url):
            raise ResearchError("No public page")
        result = fetch_research({"job": JOB}, fetch=fail)
        self.assertFalse(result["salary_evidence"])
        self.assertTrue(result["warnings"])

    def test_market_evidence_quote_must_exist_on_live_source(self):
        item = {"kind": "market", "low": 12000, "high": 18000, "currency": "USD", "period": "year", "location": JOB["location"], "source_url": "https://salary.example/report", "role": JOB["title"], "min_years": 1, "max_years": 3, "as_of": date.today().isoformat()}
        quote = f"{item['as_of']} Cybersecurity Analyst in Lagos, Nigeria: USD 12000 to 18000 per year for 1 to 3 years of experience."
        payload = {"job": {}, "salaryEvidence": [item | {"excerpt": quote}]}
        result = fetch_research(payload, fetch=lambda url: {"url": url, "html": "<p>Unrelated source.</p>"})
        self.assertFalse(result["salary_evidence"])
        result = fetch_research(payload, fetch=lambda url: {"url": url, "html": f"<p>{quote}</p>"})
        self.assertTrue(result["salary_evidence"][0]["verified"])

    def test_discovers_exact_posting_employer_site_and_retains_provenance(self):
        url = "https://job-boards.greenhouse.io/example/jobs/123"
        job = JOB | {"url": url}
        html = '<script type="application/ld+json">{"@type":"JobPosting","title":"Cybersecurity Analyst","hiringOrganization":{"sameAs":["https://linkedin.com/company/example","https://example-company.test/about"]}}</script>'
        pages = {url: html, "https://example-company.test/about": "<p>Our customers depend on protecting digital systems against security threats.</p>"}
        visited = []

        def fetch(source):
            visited.append(source)
            return {"url": source, "html": pages[source]}

        result = fetch_research({"job": job}, fetch=fetch)
        self.assertEqual(visited, [url, "https://example-company.test/about"])
        self.assertEqual(result["sources"][1]["discovered_from"], url)
        self.assertEqual(result["company_findings"][0]["kind"], "published_statement")
        self.assertEqual(result["company_findings"][0]["source_url"], visited[1])

    def test_ats_root_is_not_researched_as_company_and_other_role_metadata_is_ignored(self):
        for url in ("https://jobs.lever.co/example/123", "https://job-boards.greenhouse.io/example/jobs/123"):
            visited = []

            def fetch(source):
                visited.append(source)
                return {"url": source, "html": '<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer","hiringOrganization":{"url":"https://unrelated.example/"}}</script>'}

            fetch_research({"job": JOB | {"url": url}}, fetch=fetch)
            self.assertEqual(visited, [url])

    def test_company_careers_subdomain_discovers_corporate_root_without_suffix_guess(self):
        url = "https://careers.company.co.uk/positions/123"
        visited = []

        def fetch(source):
            visited.append(source)
            return {"url": source, "html": "<p>We help customers protect infrastructure against security threats.</p>"}

        fetch_research({"job": JOB | {"url": url}}, fetch=fetch)
        self.assertEqual(visited, [url, "https://company.co.uk/"])

    def test_only_one_extra_company_page_and_no_salary_from_company_homepage(self):
        job = JOB | {"url": "https://careers.company.test/jobs/1", "applyUrl": "https://careers.company.test/jobs/1/apply", "companyWebsite": "https://company.test/"}
        visited = []

        def fetch(source):
            visited.append(source)
            return {"url": source, "html": "<h1>Cybersecurity Analyst</h1><p>USD 10000 - 20000 per year</p>" if source == "https://company.test/" else "<p>Application form</p>"}

        result = fetch_research({"job": job}, fetch=fetch)
        self.assertEqual(len(visited), 3)
        self.assertFalse(result["salary_evidence"])

    def test_unrelated_page_salary_widget_cannot_be_selected(self):
        html = "<h1>Software Engineer</h1><p>USD 100000 - 150000 per year</p>"
        result = fetch_research({"job": JOB}, fetch=lambda url: {"url": url, "html": html})
        self.assertFalse(result["salary_evidence"])
        html = "<h1>Cybersecurity Analyst</h1><p>USD 100000 - 150000 per year</p>"
        result = fetch_research({"job": JOB}, fetch=lambda url: {"url": url, "html": html})
        self.assertEqual(result["salary_evidence"][0]["low"], 100000)


if __name__ == "__main__":
    unittest.main()
