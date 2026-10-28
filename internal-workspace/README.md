# CyberApply — Covenda internal workspace

Private mobile-responsive CV review, real cybersecurity vacancy discovery and application-request workspace. ChatGPT identity, Sites hosting, D1 history and private R2 files are retained. The app uses one fixed appearance: the existing light background, white panels and green accents. Theme controls and theme-changing actions have been removed; earlier appearance metadata remains only in saved records/history.

## Current journey

Sign in / Create account → account profile → own workspace → upload and choose a CV → review the CV → **Find live jobs** → inspect Greenhouse/Lever roles → swipe left to pass or right to **Apply** → follow the chosen CV and agent result in Applications → check related messages in Inbox.

## Application inbox

Inbox reads the signed-in visitor's connected Gmail account on request. The Gmail address must match the ChatGPT email used to sign in to CyberApply; a different connected mailbox is rejected before any message search. Sign-in alone does not grant Gmail access, and each visitor must authorize their own connection. This release supports Gmail; other email providers require a separate connection.

The page searches recent Inbox mail for employers tied to the visitor's saved Apply requests, then checks sender, company/role and application context before displaying a message. It excludes generic job alerts, unrelated mail, spam and trash. Results are capped at the first 75 provider matches and 30 displayed messages; a missing or differently worded employer email may not appear. The page provides a validated Gmail link for full reading. CyberApply returns only the matched message fields to the browser and does not save email contents in D1, R2 or the application history. Refresh makes a new read. An email shown here is evidence to review, not an automatic transition to **Applied**.

LinkedIn-specific links, connection prompts and feed status have been removed from the internal application. Existing personal records and their original source URLs/history are preserved. Demo flows, fabricated listings, seeded candidates and simulated receipts remain removed; retired demo APIs return 410.

## Real employer job discovery

Explore searches public employer boards through documented Greenhouse and Lever GET APIs. Initial boards: **Huntress**, **Recorded Future**, **Safe Security**, **GuidePoint Security**, **KnowBe4**, **Abnormal AI**, **Wiz** and **Chainguard**. Users can manage up to ten Greenhouse/Lever board URLs (including Lever EU), filter by a role-title phrase or broad cybersecurity category and location, and select Remote only. Existing saved source selections can be expanded with Add recommended sources without resetting filters. Remote status uses explicit vacancy location/workplace data, not company boilerplate. Remote does not imply worldwide eligibility.

Search is on request, not a scheduled background feed. Settings, per-board results and imported listings are saved per user and survive refresh; the agent uses the same records through `get_job_sources` and `discover_jobs`. There are 16 current MCP tools. Source calls send only board identifiers/pagination and do not send CVs, profile details, job-search filters or candidate credentials to providers.

Import safeguards:

- Fixed HTTPS API hosts, validated board identifiers and rejected redirects; no fetching arbitrary supplied listing URLs.
- At most ten boards, with at most three feed requests active at a time; 15-second per-board deadlines, 8 MB/page, bounded Lever pagination, one-minute per-user search cooldown and up to 24 new roles per search.
- Cybersecurity title/department filtering; title-phrase, location and remote filters. Import is limited to the selected employers, not the entire job market.
- Stable provider/board/posting provenance, original listing and application links, timestamp checked, deduplication and refresh without overwriting bookmarks, decisions, drafts or Apply snapshots.
- A successful complete board scan marks disappeared saved vacancies no longer listed and blocks new Apply requests. Failed/partial scans never close unseen roles. Existing requests and history remain.
- HTML is decoded into plain text and never rendered as executable markup. Descriptions are capped at 6,500 characters with a visible full-source link/truncation notice. Recognized skill mentions are explained as keyword coverage, not necessarily requirements or an ATS score.
- Pilot limits remain 200 stored jobs / 750 KB per workspace. Search reports show imports omitted by limits; narrow filters or follow original employer boards when needed.

Official references: [Greenhouse Job Board API](https://docs.greenhouse.io/job-board), [Lever Postings API](https://github.com/lever/postings-api).

## Applications: unsent requests

Right swipe / Apply records an owner-specific request and exact candidate/application-text snapshot, including the chosen uploaded CV file when one is available. It remains **Needs action / not submitted**. A request without a chosen CV says so; it can be updated with the current chosen CV. Repeating Apply does not duplicate materials or requests. Editing CV text or application text flags the materials for review while preserving the original snapshot. Opening the original employer form is a manual next step and is not proof of submission.

The previous local application agent has been retired. Settings no longer offers pairing, the four former agent API routes return HTTP 410, and the Site cannot dispatch new submissions to that worker. Current reads discard old pairing credentials and change legacy queued requests to **Needs action**. A request that was processing when the agent was removed shows **Check outcome** so the user can verify with the employer before retrying. Confirmed application receipts and history remain visible. The separate ChatGPT workspace tools remain available.

Greenhouse/Lever public job feeds do not grant application-submission permission. A new, authorized submission integration would need to be built and verified before an actual send can be enabled. See FDE-27 in Linear.

## CV review, identity and saved work

Upload a searchable PDF, DOCX or UTF-8 TXT CV and receive an automatic ATS-style readiness score out of 100, evidence for six text checks and prioritized recommendations. The saved CV text and report persist together. Stated name, email, skills and target roles fill Candidate facts where clearly identified; the candidate checks and confirms them before application materials can be marked ready. Saving CV edits updates the report; changed text clears the old file attribution. Uploading always clears the previous accuracy confirmation.

The checks cover contact details (15), clear sections (15), measured impact (20), specific action bullets (20), skills with evidence (15) and length/readability (15). An incomplete profile does not block the initial review. Suggestions ask for truthful details rather than invented claims. This is deterministic English-language text guidance, not a proprietary employer ATS result, a job-specific match score, a hiring prediction or visual-layout/OCR assessment.

Files are privately stored in R2 and parsed in the existing Worker, without sending CVs to an external scoring service. Limits: 5 MB/file, 20 PDF pages, 120,000 text characters, bounded DOCX ZIP/XML extraction and 20 saved files/account. Password-protected, unreadable or image-only documents need an unlocked/searchable export or pasted text. Failed uploads preserve the previous CV/report; revision conflicts cannot overwrite a newer record. Check extracted reading order, particularly with tables or columns. Parser libraries: unpdf 1.9.0, fflate 0.8.3 and saxes 6.0.0.

Sites supplies identity and the existing workspace access policy. D1 records and immutable revisions are owner scoped; R2 files are private. Writes require the current revision. Sources are untrusted data, never agent instructions. Historical sample records remain hidden without destructively purging stored history. Local testing uses loopback-only dispatch fixtures, never hosted impersonation.

## Verification — 17 October 2026

TypeScript and production build passed. Automated coverage: **92 checks** (14 domain + 12 job-source + 19 HTTP/storage + 9 MCP + 13 onboarding + 13 live-workspace + 12 live-source HTTP checks). Live-source acceptance fetched all three real employer feeds: 35 Huntress, 49 Recorded Future and 20 Safe Security published postings, producing 23 matching roles at the time checked. Counts can change.

Browser checks covered 320px phone and 1366px desktop layouts, no horizontal overflow, unsupported-board validation, a real filtered remote UK role, bookmarking, an actual right swipe saving an unsent request, and request persistence after refresh. No physical-phone or real employer submission test is claimed. Hosted deployment and post-release checks are recorded in the root README and Linear after publication.

Commands from this directory:

```
node node_modules/typescript/bin/tsc --noEmit
node --test tests/domain.test.mjs tests/job-sources.test.mjs
node scripts/run-framework.mjs build
node tests/job-live.test.mjs
node tests/mcp.test.mjs
node tests/onboarding.test.mjs
node tests/live-workspace.test.mjs
node tests/http.test.mjs
```

HTTP scripts require a compiled Worker on loopback port 8787. `job-live.test.mjs` performs read-only real-provider requests and writes only a generated local QA owner's records. Run HTTP early-rejection checks last: local Windows Wrangler can restart after rejecting a browser origin, so the next suite should use a fresh server. No hidden mutation retries are used.


## 17 October 2026 — Responsive swipes and centered Undo

Explore now advances cards immediately on Reject/Apply, while saves run in an ordered background queue against confirmed revisions. Drag rendering stays inside the deck component and updates at most once per animation frame. Applying stays in Explore so the next vacancy is ready; unsent requests are available in Applications.

The decision row is **Reject · Undo · Apply**, including when the last card has been dismissed. Undo reverses the latest rejection or unsent Apply request, without the old five-second timer. It removes an untouched generated draft only when that draft belongs to the cancelled request; existing/edited drafts and immutable history remain. It cannot reverse submitted applications or another job's newer decision.

Stable operation IDs prevent duplicate choices and reconcile lost responses through a fresh read rather than blind write retries. On failure, unconfirmed choices return to the latest saved state. If a save cannot be checked, further choices wait for an explicit reload. A visible saving status distinguishes optimistic feedback from saved records; navigation warns while choices are pending. No persistent browser copy of CV data or background automation was added.

Verification for this change: **91 checks passed** (19 domain, 7 deferred-network queue, 11 swipe HTTP, 19 existing HTTP/storage, 9 MCP, 13 onboarding, 13 live-workspace). TypeScript and production build passed. The deferred-network tests prove card changes and Undo happen before the server save resolves; tests cover rapid choices, lost responses, rollback, stale Undo, preserved edits, identity isolation and idempotence. Browser checks covered 320px and 1366px layouts, centered control order, keyboard rejection, Apply/Undo and an actual mobile right swipe followed by Undo/reload. No horizontal overflow was observed in those views. This is not a physical-device latency benchmark or a guarantee of zero network latency. Job-feed behavior and employer-submission access are unchanged; actual submission remains unconnected.


## 17 October 2026 — Swipe up to save for later

Explore supports three choices: **left to Reject, right to Apply, up to Save for later**. Swiping up or tapping the bookmark immediately moves the role to Saved and shows the next unsaved open card. The bookmark also updates immediately when removing a role from Saved. Saved roles remain out of Explore after refresh and employer-feed refresh; removing their bookmark makes open roles eligible again. The centered Undo restores the latest save as well as the existing Reject/Apply choices. Arrow Up provides the keyboard equivalent.

Bookmarks now use the same ordered background queue and operation receipts as swipes. Slow responses do not hold the interface; duplicate clicks, lost responses, rollback and explicit recovery use the existing safeguards. Save/Undo preserves application requests, edited drafts and job disposition. Upward and horizontal card gestures are handled by the app; downward gestures and the area around the card allow page scrolling. Short drags and ambiguous diagonals make no decision.

Validation: TypeScript and production build passed, along with **106 automated checks** (22 domain, 10 deferred-network queue, 4 direction thresholds, 16 swipe/bookmark HTTP, 9 MCP, 13 onboarding, 13 live-workspace, 19 HTTP/storage). Browser checks at 320px/1366px covered an actual upward drag, bookmark advancement, an enabled next bookmark, Arrow Up, Undo, Saved membership and persistence after refresh. No horizontal overflow was observed. These are desktop-browser viewport checks, not a physical-iPhone performance test. Actual employer submission remains unconnected. Publication evidence is recorded in Linear.


## 17 October 2026 — Live-search countdown

The live-search button shows **Search again in N seconds** during the one-minute wait and becomes available automatically at zero. Normal waiting is displayed beside the search controls rather than as a Something needs your attention warning. Form submission by Enter is guarded too. Existing results stay available while waiting; expiry enables the button without launching another search.

Workspace responses return the server's remaining wait in milliseconds. Reload resumes the remaining interval rather than starting another minute; a structured 429 response and Retry-After header allow the interface to recover if the server still requires waiting. The countdown uses relative server timing rather than assuming the visitor's clock matches the server. Saved data, revision conflict checks and the server limit remain intact.

Validation: TypeScript and production build passed; **94 automated checks** passed (6 countdown boundaries/clock offsets, 12 source normalization, 22 domain, 10 deferred queue, 16 actual-feed HTTP, 9 MCP, 19 HTTP/storage). Compiled loopback tests checked structured wait responses, matching Retry-After, reload timing, owner isolation and unchanged saved state after a blocked search. Real public Greenhouse/Lever feeds were read; no candidate information was sent. Browser checks covered the decreasing countdown, disabled button, Enter guard, persistence after reload, automatic re-enable with the note removed at zero, and 320px/1366px layouts without horizontal overflow. Physical-phone testing was not performed. Release details are recorded in Linear after publication.


## 17 October 2026 — More employer sources and broad cybersecurity searches

Added five verified employer feeds: GuidePoint Security, KnowBe4, Abnormal AI, Wiz and Chainguard. The starting list now contains eight employers, with support for up to ten Greenhouse/Lever boards. Existing saved selections are preserved; Add recommended sources expands them without duplicates or resetting keyword/location/remote filters. Source choices persist when the next search completes. The agent uses the same source limits and saved report.

Typing cybersecurity (also cyber security, cyber-security, cybersecurity jobs, information security or infosec) now selects related security roles, such as SOC Analyst, Security Engineer, incident response and GRC roles. Specific role phrases, location and Remote only remain filters. Real source department names are retained so a relevant department can explain a generic title consistently after refresh. Empty-result guidance explains that location and remote filters can still exclude vacancies.

Fetching is limited to three boards at once and retains requested source order. Existing fixed hosts, deadlines, response/pagination bounds, partial-failure behavior, owner isolation, one-minute countdown, 24-new-role import limit and saved-choice/draft preservation remain. No new paid provider or external submission was enabled.

Validation: TypeScript and production build passed; **101 checks** passed (16 source/matching/concurrency, 22 domain, 6 cooldown, 10 deferred queue, 19 real-feed HTTP, 9 MCP, 19 HTTP/storage). All eight live feeds returned matches for cybersecurity: 517 published records and 117 matching roles at the time checked; the first isolated import added 24 roles, including all five added employers. Counts change over time. Browser checks at 320px/1366px verified the existing three-board selection expanding to eight, broad keyword results, live source reports, persistence after reload, all eight source names and no horizontal overflow. These are desktop-browser checks, not a physical-phone test. Publication evidence is recorded in Linear.


## 18 October 2026 — Upload, score and improve a CV

The CV review page now leads with Upload CV, automatically reads supported files, and shows a score, the highest-priority recommendations and all six checks with evidence. Candidate facts and the extracted text remain editable below the report. Saving changes re-assesses the current saved text. No fictional candidates or demo feed were added to the hosted application.

Validation: TypeScript and production build passed, with **110 automated checks** (25 domain, 8 parser, 23 CV HTTP/persistence, 19 existing HTTP/storage, 9 MCP, 13 onboarding and 13 live-workspace checks). PDF, DOCX and TXT were uploaded to the compiled loopback Worker. Checks cover immediate scoring, persistence, ownership, failed/stale uploads preserving prior records, original file access, parser size/page/XML limits, no external fetch for PDF extraction, and continued application accuracy gates. Test fixtures are fictional and local only. Browser checks at 320px and 1366px confirmed no horizontal overflow, automatic PDF scoring and result focus, saved edits updating the report, and persistence after reload. Fictional CV fixtures were used only locally. Physical-device testing and OCR were not performed. Hosted deployment evidence is recorded in the root README and Linear after publication.

Additional commands:

```
node --test tests/resume-extraction.test.mjs
node tests/resume-http.test.mjs
```


## 18 October 2026 — View, download and delete saved CV originals

Each row in **Your saved CV files** now has separate **View → Download → Delete** controls, with accessible file-specific labels and 44px targets. PDF and TXT open privately inline in a new tab; DOCX opens a private escaped text preview with a link to the original. Word preview does not preserve document layout or contact an external document service.

Deleting requires an explicit file confirmation and the current workspace revision. It removes the original R2 object and its active attachment entry while preserving extracted CV text, the readiness report, candidate accuracy status, drafts, Apply snapshots and immutable text history. Unsaved candidate edits in the open form are retained. Cancellation makes no request. Private reads exclude removed files immediately. Storage or cleanup failures retain a durable pending entry with an explicit Retry deletion action, rather than reporting an unverified success or silently repeating a mutation.

Validation for this change: TypeScript and production build passed; **120 checks** passed (25 domain, 9 file-action/recovery/escaping, 8 parser, 27 file-action HTTP, 23 CV HTTP, 19 existing HTTP/storage and 9 MCP). Compiled Worker checks cover private inline previews, original downloads, HTML escaping/CSP, owner isolation, confirmation, stale and cross-origin deletion rejection, preserved CV text/report, persistence after reload and deletion history. Fault tests cover storage failure, cleanup conflict, unchanged original on an initial save conflict and preservation of concurrent edits. Fictional test records are local only. Browser checks verified View → Download → Delete order, a visibly rendered PDF in a new private tab, original download, confirmation cancellation, deletion of a disposable local original, retained unsaved form edits, and deletion/report persistence after refresh. Controls measured 44×44px; the 320px dialog and 1366px page had no horizontal overflow. No real hosted CV was deleted. Deployment evidence is recorded in the root README and Linear after publication.

Additional commands:

```
node --test tests/file-actions.test.mjs
node tests/file-actions-http.test.mjs
```


## 18 October 2026 — Keep the current colors and remove theme customization

The internal app now has one fixed appearance: the existing light background (`#f6f7f3`), white panels, dark text (`#20372e`) and green accents (`#27634d`). The entire original color-token block is unchanged. Theme controls were removed from sign-in/create-account, profile setup and both workspace locations. The theme provider, cookie preference reader, chooser components and alternate palettes were removed. Older browser/workspace preferences can no longer change the displayed colors.

The old `set_theme` action is rejected. Existing appearance metadata remains in historical records; no candidate data, CV files, reports, jobs, application materials or history was rewritten. No other workspace function or access policy was changed. The original local Next.js/FastAPI application is preserved separately.

Validation: TypeScript and production build passed; **72 checks** passed (25 domain, 19 account/onboarding/fixed-appearance, 19 HTTP/storage and 9 MCP). Checks cover absent selectors across entry/setup/workspace, ignored legacy cookies, rejected theme changes without a saved-state/revision change, sign-in/profile gates, ownership, concurrency, private files/history and agent tools. Browser measurements on sign-in, profile setup and the loaded workspace matched the hosted baseline exactly: background rgb(246,247,243), text rgb(32,55,46), accent #27634d and white panels. No theme controls remained; 320px and 1366px views had no horizontal overflow, and reload kept the same colors. These are browser viewport checks, not a physical-device test. Publication evidence is recorded in the root README and Linear.

## 18 October 2026 — Show CV readiness beside its saved file

**Your saved CV files** now places a text-readiness score beside the matching filename. Scores are associated with file IDs, so two uploads with the same name cannot borrow one another's score. New PDF, DOCX and TXT uploads save their own score and review date. Rechecking or changing candidate facts updates the linked file's score while its extracted CV text remains the same. If CV text changes, the earlier file keeps its last linked review and the new text review no longer claims that file. Earlier files with no known file review show no invented score. The score is a transparent text-readiness review, not an employer ATS result.

Validation for this change: TypeScript and production build passed; **52 relevant checks** passed (26 domain, 26 local CV-upload HTTP). These cover matching by file ID even when filenames repeat, retaining earlier scores, per-file score persistence after PDF/DOCX/TXT upload, rejection of bad files, owner isolation and unchanged prior records after failed uploads. A local browser inspection confirmed the empty-state copy; the existing hosted reviewed file is checked after publication. Fictional files used for automated checks stayed local.

## 18 October 2026 — Explain Candidate facts in the form

The Candidate facts form now explains that the saved name, email, skills, preferred roles and CV text support CV assessment, job fit and application materials. It asks the candidate to check and correct the details, clarifies that the accuracy checkbox is separate from the CV score, and notes that changed facts require ready drafts to be reviewed again. This is a wording-only change; scoring, saved records, Apply status and access are unchanged.

## 18 October 2026 — Guide an interrupted Apply request

When a candidate selects Apply before confirming their facts, the app now takes them directly to the Candidate facts heading and shows which details need attention. The selected job remains in memory while they check the facts and save the accuracy confirmation. A separate Continue Apply click then records the same job as an unsent request in Applications. It never checks the confirmation box automatically or claims employer submission.

Local checks passed: 36 domain/swipe tests, TypeScript, production build, and a fictional browser journey from Apply through confirmation to the unsent request. Site source `3556c004966d414517b7f7b21eed9fbea52fcdfe` was saved and deployed as private version 16 (`appgdep_6ad4c9fa323c8191af762292b1e9450e`). An initial approval attempt reported unavailable workspace credits, but a later attempt succeeded. The hosted workspace loaded at its existing record revision 29; the real user's Apply action was not exercised. Employer submission remains unconnected (FDE-27).

TypeScript and production build passed. Local browser inspection confirmed the explanation directly below the section heading at desktop and 320px phone widths, with no horizontal overflow. No new automated test was added for this text-only change. Hosted verification follows publication.

## 18 October 2026 — Applications overview

The Applications page now lists saved Apply requests separately from editable drafts. It uses existing owner-specific records and shows the request date, role, company, source provider or user-added provenance, original vacancy URL and **Not submitted** state. Source links are HTTPS-only; the request's captured URL is used for the original vacancy. The sidebar count reflects requests. Related draft materials remain accessible directly from each card.

In a fictional local test account, a new Apply choice appeared immediately as the fifth request and was still present after refresh. The page displayed both a Greenhouse employer-board role and older user-added listings with their different source labels. TypeScript, production build and 36 relevant domain/swipe tests passed. The private Site source `ceafe6aa7cae1e85e442b9b0f9313f15b22b676e` deployed successfully as version 17 (`appgdep_6ad4d2b5967c8191b938060c9d9f2614`). A read-only hosted check showed the Applications empty state for the real account's zero Apply requests. No hosted real-user Apply action or employer submission was used for testing. Automatic employer submission remains the FDE-27 dependency.

## 18 October 2026 — Direct Apply navigation and CV fact autofill

Apply from Explore now creates an owner-specific **unsent** request and opens Applications immediately, even when Candidate facts need review. Applications shows a clear review notice and a link to the candidate form. The application draft cannot be marked ready until the candidate confirms its details. No employer application is sent by this action.

Uploading a readable PDF, DOCX or TXT now fills Candidate facts from explicitly stated full name, email, skills section and target/preferred role or a clear role headline. It retains existing values when a field cannot be identified confidently and clears the accuracy checkbox for human review. It does not infer skills or aspirations from incidental prose. The extracted CV text and file-linked score continue to save with the upload.

Local verification: TypeScript and production build passed; 47 domain/extraction/queue tests, 30 CV-upload HTTP checks and 18 swipe HTTP checks passed. A fictional local browser upload showed the populated name, email, skills and preferred role, with the accuracy checkbox clear. Apply opened Applications directly with a new **Not submitted** entry that remained after refresh. Employer submission remains unconnected (FDE-27).

Private Site source `57405c3b7bf9caa7035f7aabc81b3536c1a5476a` deployed as version 18 (`appgdep_6ad4dcc936c88191bbb03235fe5cb4c7`). Hosted read-only verification showed the updated upload guidance and an existing Applications record still marked **Not submitted**. No real CV upload or new hosted Apply request was used for testing.

## 18 October 2026 — Categorized skills and common role headlines

CV autofill now reads a plain professional headline such as **Software Engineer** and removes category labels from the skills under **Technical skills**. Names such as Next.js and Node.js remain intact. The candidate still reviews every populated field and confirms accuracy separately; a summary mention alone does not become a preferred role.

TypeScript, production build, 48 domain/extraction/queue tests and 31 local CV-upload HTTP checks passed, including a categorized-skills upload. Private Site source `d4ae7ccc76038b05f1c1b8d9ae36a4f1973165d5` deployed successfully as version 19 (`appgdep_6ad4de94717881918a99ea71b9742c30`). No employer submission connection was added.

## 18 October 2026 — Candidate facts links and location

The CV review Candidate facts form offers optional GitHub repository, LinkedIn link, portfolio website and location fields. Links must be public HTTPS URLs. They save in the owner-specific profile, survive refresh and join Apply candidate snapshots. An older client saving the original profile fields does not erase these values. Editing a field clears accuracy confirmation until the candidate reviews updated facts. CV upload does not auto-extract these four fields.

TypeScript, production build and 46 relevant checks passed (31 domain, six local Worker persistence/validation/ownership, nine MCP). Local and hosted browser inspections confirmed all four labelled inputs; the hosted account was not changed. Private Site version 20 deployed from source `5242530cc05e18772c3c1cb19e4d3dfe55e715a0` (`appgdep_6ad529a05f7081919de9d5b8065ab703`). Employer submission remains unconnected (FDE-27).

## 18 October 2026 — Recheck saved CV refills Candidate facts

The Recheck saved CV action now extracts clearly stated facts again from the saved CV text tied to the current review, recomputes text readiness, and returns the refreshed private profile to the UI. It supports name, email, skills, preferred role, GitHub repository, LinkedIn profile, portfolio website and location. Absent facts retain existing values; unsafe/non-public links are ignored. The first explicit GitHub repository in project details is used when the header includes a GitHub profile link. The UI refreshes all controlled inputs and focuses Candidate facts after success.

If any fact changes, review confirmation is cleared, ready drafts are invalidated and existing unsent Apply requests indicate changed materials. Immutable request snapshots and the linked CV source remain. TypeScript, build, 77 unit checks, 36 local CV HTTP checks and nine MCP checks passed. A fictional local browser journey verified visible name restoration after Recheck; the hosted account was not changed during QA. Site source `bdc0ff310c32f92d0343e34c33664d19a2db5245` was published as private version 21 (`appgdep_6ad52e943acc8191a42b9c04fc9afe56`). Real employer submission remains unconnected (FDE-27).

## 19 October 2026 — Account settings and deletion

The workspace header and desktop sidebar link to a dedicated Account page. It provides profile editing, export and ChatGPT-backed sign-out while preserving saved work. Deleting CyberApply data requires the exact `DELETE CYBERAPPLY` phrase and a current revision. The backend locks the workspace and version history during cleanup, removes all private CV originals for that owner, and deletes the D1 workspace and revision history; interrupted cleanup can be retried. This does not delete the ChatGPT identity or withdraw applications made outside CyberApply.

TypeScript, focused ESLint and production build passed. Sixteen HTTP checks passed on an isolated local Worker with fictional data, and four additional checks confirmed that an interrupted deletion blocks history reads and can be retried; local browser sign-out returned to the sign-in page. Direct inspection confirmed zero isolated R2 objects after deletion. Hosted Account page and counts were checked read-only, without deleting or signing out the real user. Private Site version 23 deployed from source `d3c245ad40fe4baf7fa0b19095d9f1bab17d02c4` (`appgdep_6ad5f696a27081919fc7ff2f2069fc37`). Employer submission remains unconnected.

## 23 October 2026 — Choose the CV used for Apply requests

Uploading a CV now chooses it for new Apply requests. The saved CV list also lets a user choose an older file; this re-extracts its text and Candidate Facts and requires another accuracy review. Each new Apply request captures the chosen original file's ID, name, type and size alongside the candidate and draft snapshots. Applications shows the attached CV with view/download actions. Older unsent requests can be updated with the currently chosen CV. A request without one clearly says that a CV must be chosen. Deleting the chosen original clears the default and flags requests referencing that file; editing the saved résumé text clears the file selection to prevent a mismatch.

Validation: TypeScript, production build, 51 focused unit checks, the new loopback CV-selection HTTP flow, 36 existing CV HTTP checks and 18 swipe HTTP checks passed. The Site source `b77c5924fba35d8e9fdfb4de9b52df9b08f7c183` deployed as version 34 (`appgdep_6adb5baed54881918eb0b5ea061f6da9`). No real CV or employer form was used in tests. Employer submission remains unconnected.

## 28 October 2026 — Temporarily remove Candidate Facts

The Candidate Facts form and its dedicated agent tools are hidden while `lib/features.ts` sets `CANDIDATE_FACTS_ENABLED` to `false`. This preserves existing saved records and the form implementation for restoration on request. CV upload, scoring, saved-file selection, application requests and the tutorial remain. The app now asks users to review their chosen CV and exact application draft directly; a saved Apply request still does not submit anything to an employer. Historical application snapshots and activity are preserved rather than rewritten.

## 28 October 2026 — New CV application agent

The replacement agent is in `../application_agent/`, with setup and operating boundaries in `../docs/application-agent.md`. Settings creates a new user-scoped, expiring connection. On this private Site its one-time connection package includes supported Site service access from the secret `APPLICATION_AGENT_SITE_ACCESS`, configured through Sites runtime variables. Do not put this secret in source, logs or workspace records. The runner accepts the package through a hidden prompt, holds credentials in memory and sends them only to that Site without redirects.

With the connection enabled and a selected CV, a right swipe queues a v2 request while staying in Explore. Historical requests require an explicit Queue action. `/api/application-agent/claim`, `/cv`, `/authorize` and `/result` isolate the exact CV/claim, check revocation, prevent duplicate claims and require confirmation evidence for Applied. Idle polls do not create workspace revisions. `/api/agent/*` remains retired and old tokens are rejected. Candidate Facts remains hidden.

The computer's browser runner must stay open. It supports readable standard form controls and bounded multi-step/iframe navigation, grounded CV answers, overlap-aware dated cybersecurity experience, employer/company-page research and a tailored cover letter. Missing personal facts or consent can be answered for the exact application in Applications. Any possible partial submission or missing receipt becomes Check outcome and is not automatically retried. Verified employer salary bands or supplied matching market observations can produce a midpoint with monthly/yearly conversion; a web-wide salary search and paid model/research APIs are not connected. This is not universal employer coverage or a verified live submission.
