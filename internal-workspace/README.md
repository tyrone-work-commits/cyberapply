# CyberApply — Covenda internal workspace

Private mobile-responsive CV review, real cybersecurity vacancy discovery and application-request workspace. ChatGPT identity, Sites hosting, D1 history and private R2 files are retained. The app uses one fixed appearance: the existing light background, white panels and green accents. Theme controls and theme-changing actions have been removed; earlier appearance metadata remains only in saved records/history.

## Current journey

Sign in / Create account → account profile → own workspace → review CV → **Find live jobs** → inspect Greenhouse/Lever roles → swipe left to pass or right to **Apply** → review saved materials and the next action in Applications.

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

## Applications: submission remains unconnected

Right swipe / Apply records an owner-specific request and exact candidate/application-text snapshot. It remains **Needs action — connection required / not submitted**. Repeating Apply does not duplicate materials or requests. Editing CV text or application text flags changed materials while preserving the original snapshot.

Greenhouse/Lever public job feeds do not grant application-submission permission. An employer's authorized application API access is still needed before an actual send can be enabled and validated. Opening the original employer application form is a manual fallback, never proof of submission. No employer submission, paid provider or additional hosting subscription was configured for this release. See FDE-27 in Linear.

## CV review, identity and saved work

Upload a searchable PDF, DOCX or UTF-8 TXT CV and receive an automatic ATS-style readiness score out of 100, evidence for six text checks and prioritized recommendations. The saved CV text and report persist together. Saving CV edits updates the report; changed text clears the old file attribution. Uploading always requires a fresh accuracy confirmation before applying.

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
