# CV application agent — 28 October 2026

The new agent uses the exact uploaded CV attached to an Apply request. When enabled in Settings, swiping right queues a new request and keeps the user in Explore. A separate Python browser runner must be running on a computer; the hosted Site does not contain a browser. No new paid hosting or model API was activated.

## Setup and workflow

1. Upload and choose a CV in CV review. Candidate Facts remains hidden.
2. In Settings, read the authorization, enable the CV application agent and copy its one-time private connection string. This contains a user-scoped agent credential and, on this private Site, a Site service-access credential. It stays in memory and must never be committed, logged or shared in chat. The server saves only the agent credential hash; Site service access is a server secret.
3. From this repository run:

```powershell
.venv/Scripts/python.exe -m application_agent.runner --site https://cyberapply-internal.covenda-1182.chatgpt.site --browser-channel chrome --submit
```

For a new checkout create a Python virtual environment and install `application_agent/requirements.txt`. Use installed Chrome or Edge, or install Playwright Chromium and select `--browser-channel chromium`. Enter the connection string at the hidden prompt. Omit `--submit` to inspect/fill without clicking Continue or Submit. Filling or uploading can still trigger employer autosaves.

4. Swipe Apply. The runner claims the request once, verifies the exact CV digest, reads its text and inspects the original employer page. Standard controls, eligible iframes and up to six steps are supported. Additional ATS/CDN hosts require an explicit `--allow-host hostname` after checking the destination.
5. Answers use CV evidence. Dated professional cybersecurity roles count separately from other work, with overlapping months counted once. Year-only dates use a conservative lower bound. Undated roles do not establish duration. A tailored cover letter uses the CV, job responsibilities and cited employer statements, with contributions expressed as proposals.
6. Research reads bounded public job/employer pages and can discover one company page. Salary uses the selected employer's published range midpoint, or supplied and reverified market observations matching role, geography, experience, date, currency and period. Monthly/yearly conversion is supported. No web-wide salary search, paid research feed, exchange-rate feed or language-model provider is connected. Missing suitable evidence pauses the question.
7. Unknown required answers, consent, eligibility, sign-in, CAPTCHA, unsupported widgets or ambiguous navigation pause the request. Applications shows the evidence and questions. Users can save answers to the exact questions on a known unsent request and queue it again. An answer cannot authorize a different question. Any possible partial submission becomes Check outcome and cannot silently retry from the start.
8. The runner checks current authorization immediately before Continue or Submit. Applied requires a new explicit employer confirmation, its URL and text. A click without confirmation becomes Check outcome. This is browser-reported evidence, not independent mailbox verification.

## Operational boundaries

Standard readable forms are supported; this does not promise every vacancy or employer system. Keep the computer and runner running when applying from a phone. Expired tokens, blocked resources and unapproved redirects can interrupt work. Settings shows the last claim heartbeat, not proof of continuous availability. Disconnect revokes the credential. Information already sent during an in-progress browser action cannot be recalled; check its outcome.

The old `/api/agent/*` routes still return HTTP 410. Old tokens cannot operate the replacement `/api/application-agent/*` bridge. Historical requests are not automatically queued. Existing receipts and application history remain intact.

Automated tests use fabricated CVs and intercepted/local employer pages. No real application was sent while implementing this replacement. A live employer pilot still needs the user's connection, a running worker and an appropriate supported vacancy. Research details are in `application_agent/RESEARCH.md`.
