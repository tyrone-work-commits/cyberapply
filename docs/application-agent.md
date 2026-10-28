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

4. Swipe Apply. The runner claims the request once, verifies the exact CV digest, reads its text and inspects the original employer page. Standard controls, eligible iframes and up to six steps are supported. Recognized Greenhouse and Lever board/API aliases are followed automatically within the selected provider and region; a normal provider address transition does not require another user approval. All allowed addresses still need public HTTPS DNS and are pinned before browser launch. Exact domain matching excludes lookalikes. Unsupported application destinations stop with an integration limitation; this does not grant unrestricted access to every website. Optional unrelated assets/telemetry are blocked without stalling an otherwise readable form. An administrator can configure additional verified hosts with `--allow-host hostname` for a supported form.
5. Answers use CV evidence. Dated professional cybersecurity roles count separately from other work, with overlapping months counted once. Year-only dates use a conservative lower bound. Undated roles do not establish duration. A tailored cover letter uses the CV, job responsibilities and cited employer statements, with contributions expressed as proposals.
6. Research reads bounded public job/employer pages and can discover one company page. Salary uses the selected employer's published range midpoint, or supplied and reverified market observations matching role, geography, experience, date, currency and period. Monthly/yearly conversion is supported. No web-wide salary search, paid research feed, exchange-rate feed or language-model provider is connected. Missing suitable evidence pauses the question.
7. Unknown required answers, consent, eligibility, sign-in, CAPTCHA, unsupported widgets or ambiguous navigation pause the request. Applications shows the evidence and questions. Users can save answers to the exact questions on a known unsent request and queue it again. An answer cannot authorize a different question. Any possible partial submission becomes Check outcome and cannot silently retry from the start.
8. The runner checks current authorization immediately before Continue or Submit. Applied requires a new explicit employer confirmation, its URL and text. A click without confirmation becomes Check outcome. This is browser-reported evidence, not independent mailbox verification.

## Operational boundaries

### Automatic Windows background operation

Run `.venv/Scripts/python.exe -m application_agent.background setup` once. A private local setup window accepts the connection string from Settings. It encrypts the connection with Windows DPAPI for the current Windows user under `%LOCALAPPDATA%/CyberApply/application-agent/connection.dat`; no plaintext credential is saved. It registers a current-user Startup shortcut and launches `pythonw` without a console. The worker runs with submission enabled for the requests the user authorized through CyberApply. No Windows password or administrator account is saved.

The background loop checks every five seconds, uses one instance per Windows session, reconnects after network failures with bounded backoff, and honors the existing claim/uncertain-outcome protections rather than replaying a potentially submitted form. Invalid/revoked credentials require setup again. Connection credentials expire after 30 days. Automatic startup happens after Windows sign-in; the laptop must be awake and online. This is local background operation, not an always-on cloud service.

Management commands from the repository:

```powershell
.venv/Scripts/python.exe -m application_agent.background status
.venv/Scripts/python.exe -m application_agent.background stop
.venv/Scripts/python.exe -m application_agent.background uninstall
```

Stop writes a local stop request; a browser action already underway may finish first. Uninstall also removes the Startup shortcut and encrypted local connection. Disconnect in CyberApply Settings revokes the server credential. Status output contains process/timing/state metadata only, without CV content or credentials. Re-run setup to reconnect or re-enable after a stop.

Standard readable forms are supported; this does not promise every vacancy or employer system. Keep the computer and runner running when applying from a phone. Expired tokens, essential blocked resources and unsupported redirects can interrupt work. Settings shows the last claim heartbeat, not proof of continuous availability. Disconnect revokes the credential. Information already sent during an in-progress browser action cannot be recalled; check its outcome.

The old `/api/agent/*` routes still return HTTP 410. Old tokens cannot operate the replacement `/api/application-agent/*` bridge. Historical requests are not automatically queued. Existing receipts and application history remain intact.

Automated tests use fabricated CVs and intercepted/local employer pages. No real application was sent while implementing this replacement. A live employer pilot still needs the user's connection, a running worker and an appropriate supported vacancy. Research details are in `application_agent/RESEARCH.md`.
