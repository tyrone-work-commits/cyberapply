# Research and answer limits

The planner uses the selected CV as evidence for identity, skills and work history. It counts only dated professional cybersecurity roles, merges overlapping periods, and uses a conservative lower bound for year-only dates. Undated projects, education and total software experience do not establish professional cybersecurity duration.

Public company research reads the selected vacancy and application URLs, then at most one company page. It discovers that page from the exact JobPosting's `hiringOrganization.url` or `sameAs`, or from an employer careers URL's corporate root. Shared ATS and social-network roots are excluded. Saved sources include the discovery URL. Findings are attributed public statements; they do not claim knowledge of undisclosed internal company problems.

Salary handling is **not a web-wide salary search**. It uses an exact employer vacancy's published band when its currency and period are explicit. Text ranges require nearby selected-job title context; structured JobPosting ranges require the exact title. It uses the midpoint as a proposed expectation, not as the user's current or minimum salary. Monthly and annual values can be converted. Hourly conversions and currency exchange require additional evidence.

An integration may supply `salaryEvidence` market observations with the role, location, experience band, currency, period, observation date, source URL and exact excerpt. Research rereads and verifies the excerpt on the public source; the planner rejects stale or mismatched observations. No paid research provider is connected. When usable salary evidence is absent, that question needs user input.

Generated prose describes documented CV work and proposed contributions to advertised duties. It does not invent employment, qualifications, work eligibility, current salary, consents or demographic answers. Unsupported required questions remain unresolved for the runner to report.

For a specific application, `confirmedAnswers` can supply an exact question and a user-confirmed value. Matching normalizes only whitespace and case; it does not transfer an answer to similar wording or another question. Radio and select answers must exactly match an offered option. A checkbox needs an explicit affirmative answer to its complete statement. Blank or conflicting answers cannot create defaults, and unknown optional questions remain unfilled.

Research requests use public HTTPS addresses, pinned DNS resolution, verified TLS, no credentials, bounded response sizes and same-host redirects. Tests use fabricated pages; passing them does not verify a live company's content or an employer submission.
