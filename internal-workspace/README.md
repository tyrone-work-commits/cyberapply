# CyberApply - internal workspace

This directory is the current deployed CyberApply app. It uses Sites/Vinext, ChatGPT identity, owner-scoped D1 records and revisions, and private R2 CV files. The existing access policy is controlled by Sites; local preview identity must never be used as production authentication. The app retains its fixed light/green appearance.

## Features

- ChatGPT sign-in/create-account entry, setup/edit profile and account settings.
- Job discovery from Greenhouse, Lever, Ashby and SmartRecruiters published feeds, Workable’s public widget adapter and Recruitee’s Careers Site API where access is available. Fixed hosts, redirect rejection, bounded requests/bytes, HTML stripping and per-owner deduplication apply. Recruitee may require employer-authorized access. Live searches have a one-minute per-user cooldown; filtering saved results does not.
- Explore: left to reject, right to Apply, up to save; centered Undo and ordered background saves.
- Saved jobs and Applications with the chosen original CV, agent progress, employer questions, reviewed answers, outcome evidence and deletion controls.
- CV upload, view, download, delete and deterministic ATS-style text quality guidance. This is not an employer ATS score or hiring prediction. Searchable PDF, DOCX and UTF-8 TXT are supported, with 5 MB/file and 20 saved files/account; scanned/image-only documents need a searchable export.
- Related application mail from the signed-in user's connected Gmail, matched to their application employers. Gmail authorization is separate from ChatGPT sign-in. Mail is read on request and not persisted to workspace history; an email shown is not an automatic Applied transition.
- Applications has opt-in automatic employer-receipt checking, about every two minutes while the page is open and visible, plus Check employer receipts. It reads full messages from the matching connected mailbox using the existing read-only connector. A receipt must acknowledge the exact role in its receipt paragraph and match employer, applicant email, timing and receiver-reported sender authentication; generic/forwarded/old/ambiguous messages cannot confirm a request. A verified match becomes Applied and keeps its Gmail link, short excerpt and prior browser result. Whole emails are not stored. Missing receipts remain Awaiting confirmation with duplicate protection; this is not always-on mailbox monitoring or a guarantee of employer success.
- Activity/history, interactive tutorial replay, private account controls and ChatGPT workspace tools.

Demo screens/data, public password/social-login setup, theme customization, the old Candidate Facts editor and the old local-agent bridge are retired. Compatibility routes intentionally return HTTP 410, and old-data migrations remain to protect saved history. CV-derived extraction is still needed for matching and the current agent.

## Local development

Requires Node 22.13 or newer. Configure ignored checkout-local execution settings and install the locked dependencies:

```powershell
node C:/Users/ekhat/.codex/plugins/cache/openai-curated-remote/sites/1.1.2/scripts/configure-execution-profile.mjs
npm run install:ci
npm run dev -- --host 127.0.0.1 --port 5173
```

The first command is the installed Sites helper on this workstation; use the equivalent installed plugin path on another machine. Local preview uses isolated local D1/R2 state under `.wrangler/` and a loopback-only mock identity. Do not put production CVs or connection strings in fixtures. Connected Gmail preview also needs the Sites connector-preview session; see the installed Sites integration reference. Missing connector authorization should show its real connection requirement, never fabricated email.

The hosting manifest `.openai/hosting.json` declares the existing Site, D1/R2 bindings, MCP capability and read-only Gmail connector. Preserve its identity and audience. Keep the `sites()` Vite integration, Worker and connector-preview plumbing: they are runtime/build requirements, not unused UI scaffolding.

## Checks

```powershell
node node_modules/typescript/bin/tsc --noEmit
node --test tests/domain.test.mjs tests/job-sources.test.mjs tests/swipe-queue.test.mjs tests/swipe-gesture.test.mjs tests/application-agent.test.mjs tests/application-progress.test.mjs tests/application-deletion.test.mjs tests/agent-presence.test.mjs tests/expected-salary.test.mjs tests/candidate-facts.test.mjs tests/resume-extraction.test.mjs tests/file-actions.test.mjs tests/job-inbox.test.mjs tests/search-cooldown.test.mjs
node --test tests/employer-receipts.test.mjs
npm run build
```

Additional `*-http.test.mjs`, MCP, onboarding and live-workspace scripts need the compiled Worker and local fixtures; some job-source scripts perform read-only real-provider requests. Do not run every test file indiscriminately against production. Use the root Python environment for `python -m unittest discover -s application_agent/tests` from the repository root; the agent has its own Playwright dependency.

`tests/receipt-http.test.mjs` requires the compiled loopback Worker without a Gmail binding and the current local migrations. It verifies owner isolation, same-origin checks, evidence-injection rejection, concurrent throttling, safe connector failure and receipt metadata cleanup. It never sends an employer application or accesses a real mailbox. Receipt checks are throttled per owner in the separate `cyber_receipt_checks` table; unchanged checks do not create workspace history revisions.

## Application agent

The hosted Worker cannot run an employer browser. The current Python runner connects through `/api/application-agent/*`, reads the exact selected CV and saved Account Profile, attempts supported bounded form repairs, and records evidence. Profile contact/location/salary/visa/work-rights facts are never invented. Grounded generated prose and cover letters run automatically under the user's application authorization. Encountered questions and supported answers appear in Edit Profile; explicitly saved factual answers can be reused for the exact question, compatible control and choices, with job-specific answers scoped to that job. CV-derived explanations are regenerated from current evidence. Login, CAPTCHA, missing facts, employer-specific consent and unsupported destinations can still require user action. No paid language-model API is connected. The computer must be awake and online for local background processing.

Applied requires a new employer confirmation. Any possibly delivered application stays Check outcome and is protected from replay. Keep the HTTP 410 old `/api/agent/*` routes and minimal duplicate-prevention records. Full operational details and policies are in [the agent guide](../docs/application-agent.md).

## Publishing

Use the Sites source helper to open the existing source repository, synchronize these files, run checks/build, commit/push and package that exact source commit, then save/deploy a new version to the same Site. Never publish `.env`, `.wrangler`, `.sites-runtime`, private originals or local connection credentials. Record the GitHub commit, Site version, checks and any live-test limits in Linear after meaningful changes. The old standalone frontend/backend and separate-host deployment instructions are no longer part of this app.

Applications includes **Watch live**, a private read-only H.264 video player in a new tab. It uses short-lived owner/claim-bound video fragments in existing storage, without opening a second employer form or triggering submission/retry. Install `application_agent/requirements.txt` for the desktop encoder and keep the updated worker online. See `docs/application-agent.md` for retention, access and verification limits.

Future agent runs also save private recordings. **Watch recording** opens a new tab and replays the finalized MP4 independently of the live stream. Permanent application/account deletion erases saved videos; see the agent guide for limits, storage and upload-failure behavior.

Recording recovery saves playable sections during a run (first about two seconds, then ten-second sections) and retains unacknowledged uploads in a private desktop outbox. Sections replay in order in Watch recording. Capture/upload status is separate from the employer outcome; media reconciliation never retries an application. See the agent guide for recovery, limits and deletion behavior.


## Editable saved employer answers — 2 November 2026

Edit Profile → Saved employer questions now lets the owner edit and save every stored answer, including facts originally filled from general profile fields. Explicit edited answers take priority only for the exact normalized question, matching field type and compatible offered choices in a fresh application claim. General profile fields stay separate. Salary and contextual/job-specific answers are restricted to the original job, identified by employer/role where available. Updating an answer invalidates an already-claimed profile snapshot before submission; it never queues or retries an application.

Human/AI verification, consent and similar authorization answers are editable personal references only. They do not become automatic verification or employer consent. Credentials, one-time codes, hidden/helper controls and CV attachment controls are excluded from the text-answer bank.

The agent collects labelled ordinary employer questions across form pages, including optional unanswered questions. New questions and source evidence appear after reporting. Older answers are no longer rotated out at forty, and Python reuse no longer reads only the first forty. Repeated job-specific questions retain separate records by job. Automatic reports preserve explicit user edits. Storage remains finite: collection leaves headroom within the existing 1.8 MB workspace budget, keeps earlier answers when full and reports omissions rather than dropping them or losing the employer outcome.

For a diagnostic report exceeding 55,000 characters, the worker first sends the full question catalog in bounded metadata-only batches to `/api/application-agent/questions`. This requires the paired owner token and exact active claim. At most two metadata delivery attempts are made; it never retries an employer action or result POST. The result report exposes collection failures. Normal reports learn questions through the existing single result POST.

Checks: 112 Python unit tests; three intercepted browser tests for exact answer overrides, manual consent references and optional unanswered questions; 20 domain/agent/question tests in the latest focused run; 34 fictional-owner HTTP checks covering overflow collection, invalid/closed claims, editing, persistence, owner isolation, new claim snapshots, stale-answer revocation and historical deletion; TypeScript and production build. Desktop/mobile editor checks saved fictional City/eligibility/reference edits and verified refresh persistence, general-profile separation and 390×844 layout. No real employer application was queued or submitted for this change.


## Continuous recording playback — 2 November 2026

Watch recording now plays each recorded application run as one continuous, seekable MP4. The Video section selector and section numbers are removed. The browser remuxes existing silent H.264 checkpoints into one private in-memory Blob with continuous decode timestamps; it does not re-encode video, contact employers, create public files or require a desktop-worker upgrade. Original private checkpoint uploads and recovery remain unchanged. Existing recordings work without re-running applications. Separate application attempts remain separate recorded runs. Legacy single-file recordings play through the existing authenticated URL.

The pinned BSD-licensed MP4Box.js 2.5.0 library is loaded only when multiple checkpoints need combining. Playback is bounded to 61 checkpoints, 48 MB input and approximately ten minutes. Missing/unreadable or incompatible video produces an explicit error rather than silently skipping it. Refresh/growing recordings preserve the playback position and paused state. Partial-capture notices and owner-only access/deletion remain.

Verified: two remux tests check all 48 frames in three synthetic 2/3/1-second clips, exact frame-byte order, one six-second duration, continuous timestamps, invalid/truncated input and size/count limits. PyAV decoded all 48 frames and sought after the old boundaries. TypeScript and production build passed. In-browser playback decoded at 960px, readyState 4, with one seekable range [0,6]; mobile at 390×844 had no horizontal overflow. Seeking to 4.56 seconds and refreshing retained the paused position. No employer contacted or application restarted for this change.


## Reuse saved answers across employers — 2 November 2026

Supersedes the original-job restriction for explicitly saved employer answers. An owner-saved answer is reusable wherever the same question appears, including salary and role questions. Existing legacy `source=user` / `job_only` rows are also reusable without re-entering answers. Matching normalizes whitespace, case and trailing required-field stars; compatible choice widgets (select/radio/combobox/checkbox) and text/textarea controls can share an answer. Offered choices and numeric/boolean validity are still checked. Different wording, country, currency or pay-period questions are not treated as interchangeable.

The latest explicit saved answer wins across older copies. Equal-time conflicting answers and a newer cleared answer never silently revive an older value. Saving an answer synchronizes copies of that question across compatible controls and jobs. Automatic reports preserve the reusable answer instead of overwriting it or creating another employer-specific copy. Underlying provenance remains, and general Account Profile facts are not silently rewritten.

Verification, credentials and employer consent remain non-reusable/manual. Automatically generated CV/job drafts are not promoted into personal facts by collection; saving one as an explicit reusable answer remains an owner action. The profile UI explains cross-employer reuse as written. Editing answers still invalidates stale claim authorization. No application is requeued, retried or submitted by saving.

Checks: 45 focused Python tests; 21 question/domain/agent tests; three intercepted browser tests including a previous employer's radio answer filling a new employer's required select, edited profile fields and manual consent pause; TypeScript and production build. Compiled local Worker HTTP checks additionally cover persistence, owner isolation, stale-answer revocation, historical deletion and a fresh second-employer claim. No live employer application is authorized for this change.


## Open-ended employer answers — 2 November 2026

Edit Profile → Saved employer questions now includes Generate open-ended drafts and per-question Generate CV-based draft controls. These create stored drafts from the currently selected, extracted CV and the saved job posting, with supporting CV evidence and generated provenance. Bulk generation preserves explicit user answers and leaves personal facts/choices untouched. Unsupported specific experience and insufficient CV evidence produce an explanation, never an invented credential or personal history. Drafting does not queue, resume or submit an application.

The desktop planner supports professional interest, summaries/background, strengths, contributions, approaches, additional information and CV-supported experience explanations, including “Please explain” wording. Ordinary generated prose is filled automatically without a new approval gate under the existing user instruction. Saved explicit answers keep their existing priority. No new model provider, API key or paid service is connected; this extends the existing deterministic CV-based drafting system.

Employer requests for no AI/ChatGPT-written application answers are recognized in question wording and job descriptions, including line breaks. Such questions receive an own-wording notice. An earlier automatically generated profile answer is cleared/flagged during generation; explicit user text is preserved. In forms, prohibited generated prose/cover letters pause before automatic filling/Submit. Generated provenance survives Save, so a saved generated draft cannot become a supposedly human-written answer for a no-AI form. The Chainguard example explicitly falls under this exception and needs the applicant's own words.

Checks: shared Python planner/unit regression suite; focused browser fixtures for automatic prose, automatic cover-letter upload and a no-AI pause; 25 domain/question/agent tests and final question checks; 51 fictional-owner HTTP checks for profile drafting, persistence, owner isolation, no-AI notices, stale-answer revocation and deletion; TypeScript and production build. Browser UI created two grounded fictional drafts and flagged a separate no-AI question without contacting an employer. No real application is submitted as part of this update.


## Owner override for ordinary no-AI wording — 2 November 2026

Supersedes v76's content-only no-AI drafting pause, at the owner's explicit request. Ordinary “do not use AI/ChatGPT” wording in a narrative prompt or job description no longer blocks CV-grounded drafting, cover-letter generation, reuse or filling. Removed the corresponding profile notices and browser pause path. Generated origin/evidence remain visible; no authorship is misrepresented and no model API/service was added.

Generate open-ended drafts still preserves explicit saved answers in bulk. Generate new CV-based draft on one question explicitly replaces that question's earlier answer, retaining revision history; other answers stay unchanged. Old content-only no-AI generation notes are cleared on regeneration/save. CV evidence, personal-fact safeguards, missing-fact pauses, consent, human verification, destination authorization, receipt requirements and duplicate prevention remain. Actual authorship declarations (for example, certifying no AI was used) are separate manual factual statements and cannot be automatically filled with a false claim.

Verified with the agent unit suite, 27 question/domain/agent tests, intercepted browser forms for drafting/filling despite no-AI wording and for truthful authorship/consent pauses, TypeScript and production build. Fictional-owner HTTP checks cover regenerated drafts, preservation, ownership and unchanged application outcomes. No employer submission is authorized by this update alone.

## Complete CV evidence in generated prose — 2 November 2026

The profile generator and Python narrative planner now reconstruct PDF-wrapped work statements before ranking CV evidence. Bullet, section and metadata boundaries remain separate; dangling conjunction fragments are excluded. Skills labels such as “Secured Frameworks:” are metadata, not work claims. Profile responses turn supported action statements into complete first-person sentences and separate the introduction, evidence and proposed contribution into paragraphs. This fixes clipped answers such as “integrating secure Built a … and I would …” observed when regenerating the two Chainguard questions. No model provider, new candidate fact or employer submission is introduced.

Validation: 21 profile-question/domain tests, 88 Python answer/planner/memory/profile tests and TypeScript. Production packaging runs the normal Site build; hosted per-question generation verifies the actual saved answers after publication.

## Employer choices in Edit Profile — 2 November 2026

The browser agent reads bounded, explicitly linked custom dropdown lists before planning an answer, without selecting an option. Encountered questions retain their offered choices in Account Profile even when the CV/profile cannot answer them. Later reports enrich choices without overwriting a user's answer, and empty reports retain earlier choices. Lists are bounded to 100 choices and identify truncation.

Edit Profile displays the captured choices in a select control alongside the editable answer. Selecting a choice only edits the local draft; Save is separate. Refresh employer choices can refresh an existing Greenhouse vacancy's public question metadata without a browser run, CV/profile transmission, queue or employer submission. The fixed Greenhouse GET endpoint is bound to the owner's saved vacancy and verified job ID; redirects and malformed sources fail. Existing answers, application outcomes and selected CV stay unchanged. Verification/consent choices remain references that cannot automatically complete verification or grant consent.

## Dropdowns in Applications — 2 November 2026

Answer this employer’s questions now renders original select/combobox questions as dropdowns. It uses the question's recorded options, with a same-vacancy Account Profile fallback or newer refreshed choices. Other employers' options are excluded. No option is selected by default. Non-choice questions remain text fields; questions requiring an Account Profile correction retain that flow. A previous answer absent from the available choices must be reviewed before approval. Every edit clears the local approval checkbox, and choosing an option does not save, queue or submit anything. Missing/truncated lists are explicitly identified.

## Career upgrade checkpoints

The upgrade ledger is `../docs/upgrade-plan-2026-11.md`. Dashboard, ATS scan reports/history, an evidence-preserving optimizer, guided résumé builder with text PDF/DOCX exports, reviewed cover letters, discovery/search and private company bookmarks are implemented. The remaining prompts add application settings/Actions, a job tracker and calendar export, LinkedIn-content optimization, interview practice, optional profile details, private notifications/Help/export, an inactive commerce scaffold, learning guides and a scoped job-page extension. See the ledger for adaptations and inactive integrations. The original CV is retained and generated CV versions are selected for applications only through an explicit action. Provider `none` is the default; no paid model, billing, sending email or publishing service has been enabled.

## Source access and refresh

Save selected employer boards in Explore or Add a listing. Manual Refresh now preserves existing choices, drafts and application records. The current background runner checks due sources only while idle, at most once per five minutes; the server leases each refresh and makes a successful source due again after `JOB_REFRESH_HOURS` (default 12). Feed errors retain prior jobs and schedule a bounded later check. A partial board never closes unseen vacancies. Keep the computer awake and runner connected, or refresh manually; this is not a cloud scheduler. Restart an older runner with the checked code to gain this capability. No runner was restarted as part of upgrade QA.

Workable’s widget JSON is not the authenticated Workable SPI API and may change. Recruitee documents token enforcement from **10 February 2027**: <https://docs.recruitee.com/reference/authentication-1>. If Covenda obtains employer-authorized Careers API tokens, configure server-only `RECRUITEE_BOARD_TOKENS` JSON mapping exact lowercase board subdomains to their matching token. No token belongs in the UI, saved-source records, Git or chat. Tokens are sent only in a header to that board’s fixed careers API host. Nothing here creates employer access or permission to automate submissions; the application agent retains its destination/consent/verification boundaries.

Source fixtures under `tests/fixtures/job-feeds` were captured from public endpoints on 4 November 2026, reduced to one record and stripped of contact data; descriptions use explicit fictional test requirements and pagination metadata reflects the reduced fixture. Automated tests use these fixtures without live network. Manual read-only contract checks observed 72 Ashby jobs, 16 Workable jobs, 11 Recruitee jobs and a SmartRecruiters listing/detail. These checks did not submit applications or verify every employer’s future API behavior.


## Browser extension and final checks

See `../extension/README.md`. Build with `node extension/build.mjs` from the repository root, then explicitly load the unpacked folder in Chrome. Settings links to scoped connection creation/revocation. The private host can require authenticated job transfer instead of direct token requests; no global Site access credential is bundled. Save/Scan never submit an employer application.

Run `node scripts/test-offline.mjs` from this directory for the deterministic suite (289 tests at the upgrade checkpoint). TypeScript and the production build are separate checks. Read `tests/README.md` before running the old HTTP harnesses: they need disposable isolated mock servers and must not target production or a user's retained preview.
