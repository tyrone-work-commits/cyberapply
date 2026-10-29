# CV application agent — 29 October 2026

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
6. Applicant zip/postal code, location, street address, city, country and international phone come exclusively from saved **Edit Profile**, not CV extraction, market research or previously confirmed form answers. The claim snapshots those exact fields and expected salary. Authorization checks compare that snapshot with current saved values immediately before any data submission; a relevant profile edit stops stale submission. Queued requests use the latest profile when claimed. Historical requests and outcomes remain intact.
   Expected salary uses only the saved USD monthly/yearly expectation, with multiplication/division by 12 and cents rounding when the employer specifies the other period. Numeric fields need explicit currency and pay-period information. Other currencies, hourly/daily/weekly rates, missing profile data, mismatched options and current/past/minimum salary questions pause rather than inventing an amount or exchange rate. Complete missing details in Edit Profile and requeue a known unsent request. No salary research is performed; public company research remains for cover letters. A worker must send `profileAnswersVersion: 2` to claim, preventing older runners from using the previous policy.
7. Unknown required answers, consent, eligibility, CAPTCHA, unsupported widgets or ambiguous navigation pause the request. Supported employer sign-in can use a previously saved session, or open a private sign-in handoff before any application delivery. Applications shows the evidence and questions. Users can save answers to the exact questions on a known unsent request and queue it again. An answer cannot authorize a different question. Any possible partial submission becomes Check outcome and cannot silently retry from the start.
8. The runner checks current authorization immediately before Continue or Submit. Applied requires a new explicit employer confirmation, its URL and text. A click without confirmation becomes Check outcome. This is browser-reported evidence, not independent mailbox verification.

## Operational boundaries

### Remembered employer sign-in

The Windows runner automatically attempts encrypted session reuse for the selected employer. It uses a dedicated agent browser context; it does not copy the user's personal Chrome profile. A CyberApply owner/site namespace and employer partition isolate sessions, including different employers on shared Greenhouse/Lever domains and embedded boards. Supported aliases for the same employer share a partition. Only allowed HTTPS-origin storage and matching cookies are retained. Session files are protected with current-user Windows DPAPI under the local agent's sessions folder, outside the repository. No password-input field, verification-code input, screenshot or sign-in transcript is recorded.

When a password form appears before any possible application delivery and no usable session exists, the runner opens a separate Chrome sign-in window and a small CyberApply continuation window. The user enters credentials and completes any verification privately in Chrome, then selects **I have signed in — continue application**. The runner checks current request authorization, saves the scoped session encrypted, and returns to the selected vacancy using that state. It prompts at most once per attempt, times out after four minutes and does not treat sign-in as proof of application delivery. Login after a possible partial application is Check outcome and is not restarted automatically. Unsupported external SSO providers and CAPTCHA challenges are not bypassed.

Saved sessions may be reused for up to 14 days after private sign-in, and websites can expire/revoke them sooner. Background refresh does not extend that local reuse period. Cancelled or revoked handoffs do not save a session. A bad/expired cache requires sign-in again. Clear the current CyberApply account's saved employer sessions with:

```powershell
.venv/Scripts/python.exe -m application_agent.background clear-sessions
```

This clears saved local session files; it does not remotely sign out of the employer or revoke a browser context already doing work. No real employer login has been verified by the implementation tests; tests use fabricated accounts/state and intercepted forms or mocked sign-in windows. Initial password/MFA entry still belongs to the user. Sites that cannot restore supported browser state may still need manual application completion.

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

Standard readable forms are supported; this does not promise every vacancy or employer system. Keep the computer and runner running when applying from a phone. Expired tokens, essential blocked resources and unsupported redirects can interrupt work. Settings shows recent background check-ins, not proof of continuous availability. Disconnect revokes the credential. Information already sent during an in-progress browser action cannot be recalled; check its outcome.

### Reconnect from Account Settings

Account Settings includes **Open agent setup**, **Refresh background status**, and instructions for reconnecting privately. The setup button uses `cyberapply-agent://setup`, registered for this Windows user by background setup. Existing installations can register it once with `.venv/Scripts/python.exe -m application_agent.background register-setup`. The fixed launcher accepts only the setup action; it does not accept credentials, commands or arbitrary URLs. The link contains no token. The browser may ask permission to open the local program. If the browser blocks external-app links, run the setup command above directly. Setup opens on the Windows computer with the agent installed; a phone can view status but cannot launch that computer's setup window.

The background worker sends an authenticated check-in every 20 seconds while idle or processing a form. Account Settings refreshes every 10 seconds while visible. Only a check-in within 75 seconds for the current, unexpired connection can show Connected. Stopping, stale check-ins, token expiry and disconnection do not count as an online runner. Token expiry is displayed separately. Presence is scoped to the account and token and stored separately from application revisions, so status polling does not create build/history noise. Replacing a token requires pasting the new connection string into setup; the application cannot recover an existing plaintext token.

The setup window shows safe local process state and its timestamp without displaying saved credentials. Reconnecting stores the connection encrypted, enables current-user Windows startup and starts the worker. Uninstall removes only this installation's setup link. This remains a local service: Windows must be signed in, awake and online.

The old `/api/agent/*` routes still return HTTP 410. Old tokens cannot operate the replacement `/api/application-agent/*` bridge. Historical requests are not automatically queued. Existing receipts and application history remain intact.

Automated tests use fabricated CVs and intercepted/local employer pages. No real application was sent while implementing this replacement. A live employer pilot still needs the user's connection, a running worker and an appropriate supported vacancy. Research details are in `application_agent/RESEARCH.md`.

## Clearing the application tracker — 29 October 2026

Applications has **Clear all applications** and **Restore cleared applications**. Clearing moves the current request records and saved drafts into a private recoverable archive, empties the tracker and releases unsent vacancies back into Explore. It preserves account profile, CV files, the selected CV, saved jobs, agent connection and earlier workspace revisions. Queued requests lose authorization and are not claimed after the clear. Clearing is rejected if a request is processing; optimistic revision checks also prevent racing a newly claimed request.

Restoring never queues or submits applications and does not replace a newer request for the same vacancy. Previously Applied or uncertain records remain protected against a duplicate Apply by job ID or original URL, even when hidden from the tracker. Use Restore to review those outcomes. Clearing the list does not withdraw an employer application or permanently erase its records. New requests for known unsent jobs receive fresh IDs and do not inherit earlier question approvals.

## Generated-answer approval and country eligibility — 29 October 2026

Edit Profile now keeps separate nullable Yes/No facts for UK/USA/Canada visa requirements and current right to work. These are never derived from each other or from the applicant’s location. Simple matching questions use the saved choice, including native select/radio controls. Missing choices, combined countries, negative wording and conditional eligibility pause for review. Other countries still require explicit user-provided answers.

Experience/tool Yes answers require matching CV evidence; unrelated tools and qualifications are not invented. Explanations and other supported CV-grounded prose are prepared as draft suggestions in Applications. A persistent in-app notice identifies requests awaiting approval. Drafts appear in editable fields and are withheld from the employer until the user explicitly approves their exact text. Cover-letter uploads also require exact approved text; the chosen CV remains available for authorized application steps. Any edit resets the review checkbox. CV/material changes clear saved question approvals.

This is the current no-new-API-cost drafting path: CV evidence, the selected role and bounded public company research. No language-model API has been connected. The agent cannot reliably invent arbitrary personal, legal, screening, technical or numeric answers: unsupported questions pause for user input instead. A broader model provider and any extra costs remain a separate decision.
