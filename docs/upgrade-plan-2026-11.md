# Sorce + Jobscan upgrade execution — 4 November 2026

Source: the user's 28-page Cyber Apply Upgrade Plan PDF. It describes the retired Next/FastAPI public prototype. Implement feature intent in the current internal Sites/Vinext/React app, authenticated through unchanged ChatGPT identity, owner-scoped D1 and private R2. Do not recreate retired authentication, demos or colour themes. Optional billing stays disabled. No paid provider, mail delivery, account connection or real application is activated by this upgrade.

## Ordered checkpoints

| Prompt | Work | State |
|---|---|---|
| 0 | Protected authentication and upgrade guardrails | Implemented; existing project rules preserved |
| 1 | Central server writing service, basic mode, quotas and status | Implemented; 6 tests, TypeScript and production build passed |
| 2 | ATS scan engine and private scan records | Implemented; 14 logic/storage/file tests, TypeScript and production build passed. PDF structure beyond fonts/page data remains explicitly unverified |
| 3 | Dashboard, match reports and history | Implemented; TypeScript/production build and local browser checks passed at 375/768/1280px. Created pasted/PDF scans, renamed, reloaded, changed history status, opened guide and highlighted keywords |
| 4 | Optimize editor and evidence-preserving suggestions | Implemented locally; 6 optimizer tests, TypeScript and production build passed. Browser verified saved version, comparison, export and explicit CV selection. PDF/Track/cover-letter links await prompts 5/10/6 |
| 5 | Resume builder, versions and exports | Implemented; 14 relevant optimizer/builder/storage tests, TypeScript, build, PDF render and local browser checks passed |
| 6 | Cover letters | Implemented locally; 20 JS tests, 6 targeted browser/planner tests, 20 planner tests and 13 recording/question-delivery regression tests passed; TypeScript/build and local browser QA passed |
| 7 | Discovery improvements and companies | Implemented locally; 36 browse/feed/gesture/queue tests, TypeScript/build and local UI checks passed. Touch pointer delivery remains unverified |
| 8 | More supported job feeds and refresh | Implemented locally; 30 feed/storage/lease tests, 15 runner regression tests, TypeScript/build and local saved-source/live read-only refresh checks passed |
| 9 | Apply settings, answer library and Actions | Pending; existing agent/consent/memory retained |
| 10 | Tracker, interviews and thank-you drafts | Pending |
| 11 | User-supplied LinkedIn content optimizer | Pending |
| 12 | Interview practice | Pending |
| 13 | Optional extended profile and setup | Pending |
| 14 | Notifications, help and settings | Pending; existing delete/sign-out retained |
| 15 | Optional disabled commercial scaffolding | Pending; internal defaults remain free |
| 16 | Learning centre | Pending |
| 17 | Optional scoped browser extension | Pending |

## Verification

Keep factual checks, per-owner data isolation, auth boundaries, original CVs, employer confirmations and duplicate prevention. Sample reports are explicit examples, never live applications. Record exact checks and rollout limitations at each checkpoint. A lower-level scaffold is not completion of a user-facing feature.

## Provider references

- OpenAI Responses: https://developers.openai.com/api/docs/guides/text
- Anthropic Messages: https://platform.claude.com/docs/en/api/messages/create
- Ashby public job boards: https://developers.ashbyhq.com/docs/public-job-posting-api
- SmartRecruiters public posting API: https://developers.smartrecruiters.com/docs/endpoints

## Checkpoint 3 evidence

- Dashboard after sign-in; Explore stays one tap away, and signed-in logos target Explore.
- Explicit fictional sample uses no scan quota. New scans accept saved CVs, private direct uploads or pasted text. Reports show skill counts/context, category advice, detected ATS/tips, editable title, print, rescan, exclusions and keyword highlights. History has progress labels, paging, archive and sorting. Tracker/LinkedIn dashboard integrations remain pending their later prompts.
- Local QA only, using the existing fictional Alex Preview account: created a pasted scan, saved a title change and verified it after refresh; changed a scan's progress to interviewing and verified after refresh; uploaded a synthetic PDF and observed its font/page checks. No application was queued or submitted. Existing CV selection and application workspace revision stayed unchanged.
- Screenshots: `output/upgrade-scan-desktop-local.jpg`, `output/upgrade-scan-tablet-local.jpg`, `output/upgrade-more-mobile-local.jpg`, `output/upgrade-report-guide-mobile-local.jpg` (untracked QA artifacts; no real CV data).
- Local migration baseline used historical ad-hoc SQL rather than Wrangler migration history; applied only the two new SQL files locally, preserving prior fixture records. Production uses the normal Sites/Drizzle deployment path.

## Checkpoint 4 evidence

Optimizer sessions have per-owner versions, direct editing, live rescoring, before/after review and accept/reject. Unsupported claims are rejected; missing skills require actual user evidence. Embedded and standalone summary tools use the central provider or explicit basic fallback. DOCX export preserves matched source paragraphs and run formatting, including line breaks; unmatched changed paragraphs fail clearly. Clean DOCX and saved library versions do not replace the chosen application CV. Local fictional QA saved v3 and reloaded it, downloaded DOCX, saved a new library version and verified approval-qa.txt stayed chosen. No real application or external AI call made. Published v83 remains prompts 0–3 until the next rollout.

## Checkpoint 5 evidence

Added a seven-step builder, eight single-column layouts, editable/reorderable sections and role/education entries, blank/profile/saved-CV/upload/pasted-LinkedIn starts, per-document autosave with conflict errors, rename/duplicate/delete, last-20 version restoration, evidence-only Coach/summary/bullet/skill drafts, job matches, PDF/DOCX preview/download, save to CV library and explicit Set as main résumé. Saved CV files have rename/duplicate/Open in builder. Optimizer now also exports PDF. PDF uses embedded OFL Noto Sans with honest unsupported-character errors; DOCX uses the selected template font. No browser renderer or paid service is required in the Worker.

Tests extracted real Unicode text from all eight PDF layouts and checked single-column coordinates, DOCX text/style settings, entry limits, import confirmation, owner isolation and autosave conflicts. Rendered and visually inspected the fictional PDF. Local browser created fictional Zoë résumé, changed name/template/contact/spacing, added a section, observed v4, downloaded PDF and reloaded v4 successfully; no horizontal page overflow at 375/1280px. Screenshot proof in output/upgrade-builder-{desktop,mobile}-local.jpg. Production build passed. No real applicant details changed or employer submission made.

## Checkpoint 6 evidence

Added explicit-only Generate/Rewrite cover letters, eight styles, four tones, three lengths, evidence-ranked focus, saved CV/upload/paste and job/scan inputs, edit/save/history, copy and PDF/DOCX downloads. Entry links are available from job detail, optimizer and application cards. Reviewed letters can be explicitly attached to a matching unsent application, with an immutable DOCX/text snapshot. Attaching pauses the request and never queues or submits. Processing/delivered/uncertain requests and wrong-vacancy letters are rejected. The worker uses exact reviewed attachment bytes and SHA-256 verification; old runners pause before processing a reviewed attachment until restarted with this code. Existing CV/profile/consent/duplicate/receipt safeguards remain. Tracker linking waits for Prompt 10.

Verified 20 relevant JavaScript tests, 20 planner unit tests, 6 targeted fixture-browser/planner tests, 13 recording/question-delivery regression tests, TypeScript and production build. Local fictional UI generated a letter without adding a JD-only skill, saved v2, downloaded its PDF and reloaded the edited name; mobile width 375px had no overflow. Rendered/visually checked downloaded letter PDF. No real employer form or application was submitted, no model provider activated. Live v84 remains prompts 0–5 pending next rollout.

## Checkpoint 7 evidence

Added remembered Cards/Grid, richer factual job cards, qualifications/preferred details, read more, source-link share, similar roles, S/Z/down shortcuts, dedicated touch-safe down-drag handle, explicit Cybersecurity-only filter, pay/date/type/work-mode/sponsorship/size/industry filtering, fit/date/relevance sorting and owner-scoped server paging. Manual jobs bypass only the cybersecurity category filter, not explicit search constraints. Private recent searches persist independently of live-search cooldown. Search has results/detail columns. Companies show known data and honest unknowns, open jobs, own applications, shared-skill companies, durable Follow bookmarks and private report notes. Followed-company links in the full profile await Prompt 13. The share target is the original public vacancy rather than an owner-private job ID. Metadata is populated when providers supply it; additional extraction follows in Prompt 8.

Verified 36 logic/feed/gesture/swipe-queue tests, TypeScript and production build. Local fictional UI added a clearly labelled test listing (no application sent), opened similar roles using Down, remembered Grid after reload, excluded unknown pay via pay filter, reset without live search, opened side-by-side Search/company detail and persisted Follow across reload. No overflow at 375/1280px. Pointer/touch dispatch was not manually verified; direction math and keyboard path were verified. Source search is still limited to existing providers until Prompt 8.

## Checkpoint 8 evidence

Added fixed-host Workable-widget/Ashby/SmartRecruiters/Recruitee adapters alongside existing sources; provider URL parsing, no redirects, bounded byte/request/page budgets, HTML cleanup, hidden/template exclusion, canonical provenance, salary/employment/industry metadata and deduplication. Source access failures preserve prior results. Recruitee’s optional employer token map is server-only and never returned in a source record. Description extraction annotates hard/soft skills, certifications, experience requirements, education, pay, explicit work-mode/sponsorship and clearance statements; ambiguous currency/eligibility remains unknown. Applies to imported, newly pasted and older saved jobs without changing applicant facts.

Saved sources are private, stable-ID records with CAS leases, Refresh now/Remove and due times. The existing runner checks sources while idle and the server defaults to a 12-hour successful refresh interval; no cloud scheduling service or paid API was added. Existing worker processes must restart with this code to use refresh. Background refresh restores the user’s discovery filters/cooldown and never queues or submits a job.

Checks: 28 recorded-feed/legacy-feed/storage tests plus 2 saved-source lease/isolation tests passed; 15 runner source/recording/question-delivery tests passed; TypeScript and production build passed. Reduced/redacted public API fixtures cover all four new providers without live network in automated tests. Manual public read-only contract checks succeeded on all four; local browser saved nine boards, refreshed Ashby (72 published / 0 cybersecurity matches under selected filters), observed next due exactly 12 hours later and reloaded the stored schedule. No overflow at 375px; Applications stayed at the same nine fictional local requests and the chosen CV stayed unchanged. No live employer submission or credentials grant. Native live Site remains v85 pending the next checked rollout.

Rollout: checkpoints 0–8 are now published as Site v86 (source e6f5535c71341640d3695802e0ed96fe943367da). Native deployment succeeded; workspace audience and read-only Gmail integration retained. Authenticated live feature QA remains limited by the existing consent screen.

## Checkpoint 9 evidence

Added a two-step Apply settings sheet, exact CV selection, automatic/review mode, explicit authorization timestamp, minimum keyword match and per-UTC-day run limits enforced before claims. A mode switch holds queued work and blocks automatic submission authorization for a run already in progress. The header has a quick toggle with mode-only Undo and run counts. Review mode means review before starting the browser agent; it does not promise an interactive final employer-form review. Existing explicit agent authorization is retained rather than requested again.

Added Actions with one question at a time, captured dropdown options, factual drafts clearly requiring review, Skip, default reusable-answer saving and explicit continue-if-complete. The answer library has Auto/Past tabs, editing, removal, source and last-used evidence. Current exact confirmed answers take priority over older generic answers. Manual verification/authorship and profile facts retain their boundaries. Possible delivery is excluded from Actions and cannot be requeued. Changing a request to a different CV removes its earlier reviewed cover-letter attachment. Application details link similar roles. “I applied elsewhere” creates separate user-reported tracking data and duplicate protection, never a claimed employer receipt.

Local browser QA used only the fictional Alex Preview account: saved a reviewed answer without continuing the agent, observed the question count decrease and its reusable answer persist; changed the daily limit to 10, reloaded and verified it; checked the settings at 375px and 768px with no horizontal overflow. Original chosen CV stayed unchanged. No real application, provider call or account grant. Policy tests cover consent, limits, review-mode changes, possible delivery and held-question release; TypeScript and production build passed. Source and publication details are recorded in Linear. Prompts 10–17 remain unfinished.

## Checkpoint 10 evidence

Added an owner-scoped five-stage tracker with idempotent on-open synchronization from saved jobs, linked scans, agent requests and user-reported external applications. Generic versioned career records hold items and their bounded notes/contacts/tasks/interviews rather than creating a second relational subsystem. Personal stages, manual applied dates and agent outcome evidence remain distinct. Manual edits are preserved during sync; removed source items have tombstones so reopening does not recreate them. Offers require salary; new interviews move to Interview. Board has search/star/archive, mouse/touch grip interactions, mobile stage tabs/swipe actions and an accessible Move menu. Drawers cover overview, CV selection/private upload, cover letters, multiple interviews, editable thank-you drafts, contacts, notes, tasks and history. Tracker attachments never replace an application’s captured original CV. Application and scan entry links are wired.

Interview calendar has a per-owner regenerable secret and authenticated ICS download, escaped/folded UTF-8 lines, stable event UIDs, UTC times and 24h/1h alarms. The private Site cannot offer unauthenticated subscription to external calendar servers without weakening access; use explicit download/import into Google, Apple or Outlook. No public bypass token, account sharing or external message was introduced. Deterministic in-app reminder candidates are ready for Prompt 14; no always-on cloud scheduler is claimed.

Eleven tracker/storage tests passed: source-stage automation, uncertain/receipt separation, manual-stage preservation, offer and timezone validation, ICS injection/folding/alarms, reminders, factual thank-you fallback and owner isolation/CAS. TypeScript and production build passed. Local fictional browser QA created a manual item, added/saved an interview, observed Interview stage survive reload, generated a basic thank-you draft, downloaded a valid ICS and checked 375/1280px layouts without page overflow. Mouse/touch drag delivery remains unverified; Move menu is the accessible fallback. No real application sent or existing applicant facts changed. Prompts 11–17 remain unfinished.

Rollout: checkpoints 0–10 published as Site v87, source eba0422e3cc29c1033177ae749eb47769c03a171. Native deployment succeeded with the existing workspace audience and read-only connector retained.

## Checkpoint 11 evidence

Added a two-step LinkedIn optimizer using user-pasted sections or an uploaded PDF and 3–10 distinct target descriptions, including saved-job/scan selection. The URL is stored only; no LinkedIn access or scraping occurs. Private owner-scoped history retains the parsed profile content, score, section feedback, found/missing skill frequencies, optional skill suggestions, profile tips and three factual headline/About drafts. PDF sections that cannot be identified remain unknown, and raw PDF text is not counted twice. Uploaded LinkedIn PDFs are parsed into the private report rather than changing the chosen application CV. Drafts use the central writing service/basic fallback with the same evidence guard. Dashboard shows the latest profile score.

Three targeted logic tests passed for distinct targets/safe URL validation, keyword frequency/factual fallback and PDF uncertainty/counts; existing career storage tests cover owner/version isolation. TypeScript and production build passed. Local fictional browser generated a 60/100 report, observed missing Linux/Splunk/Communication suggestions absent from its draft headlines, reloaded and reopened history, and checked 375/768px without horizontal page overflow. No LinkedIn account connection, real profile change or paid model call. Site v87 currently excludes this checkpoint; prompts 12–17 remain unfinished.

## Checkpoint 12 evidence

Added three-step interview-practice setup for general, job-specific or custom questions; optional saved CV/job/scan snapshots; 35 original curated topics; central-provider question generation with curated fallback; question/time limits, countdown/progress, Skip/Leave, saved history, review, retake and delete. Text mode works without device permissions. Audio/video use explicit Start recording with MediaRecorder and bounded file sizes; the user must type/correct the transcript. Optional browser speech recognition is separately explained because the browser vendor may process audio. No server transcription provider is enabled. Read-aloud is an explicit optional action, unrelated to completion notifications.

Content feedback is clearly labelled basic lexical coaching with relevance, specificity, STAR cues and a template outline requiring real details; it is not an employability assessment or an invented autobiographical answer. Speech rate uses a recording-linked transcript and measured clip duration only; plain text has no WPM. Pauses stay unmeasured unless actual ordered word timestamps are supplied. No fake audio metrics. Media has owner-authenticated private storage, bounded container validation and byte-range playback. Playback expires after 30 days; physical cleanup runs on the owner’s next practice activity, not an unconfigured cloud cron. Practice files stay separate from application/CV material.

Ten practice/storage tests passed, TypeScript and production build. Local synthetic-only API QA uploaded a two-second MP4, denied anonymous session/media reads, verified 206 byte-range access and linked it to a saved answer. Existing career-store isolation tests cover cross-owner access. The preview does not offer separate mock header identities, so additional cross-owner HTTP mutation testing was skipped rather than touching another account. Browser QA saved a fictional text answer, reopened history after reload and loaded the synthetic video (2s, readyState 4, no media error), with no page overflow at 375/768px. No microphone/camera permission activated, real interview recorded, paid AI call or employer submission. Site v87 excludes prompts 11–12 pending rollout; prompts 13–17 remain unfinished.

Rollout: checkpoints 0–12 published as Site v88, source 2e4b17365364c695d241b2c0c6171bfb2a6377f9. Native deployment succeeded; workspace audience and read-only integration retained.

## Checkpoint 13 evidence

Added post-sign-in guided setup with three brief introductions, saved section progress/Finish setup later, saved-CV/private upload suggestions, explicit blank-only name/role/location/contact-email prefill, discovery source, international phone code selector, optional voluntary disclosures/birthday, apartment and street-address opt-out, explicit geolocation capture/remove, country interests with nullable rights/visa answers, education/work entries or no-history choices, six-step skippable preferences, followed-company count/link, invite code, extended optional professional/contact fields, additional private files and shared scan exclusions. Core address/city/state/country/salary/visa fields remain in the existing basic profile and retain their agent rules. New sensitive additions are isolated in private career records and never automatically passed to an employer. Strength excludes demographics, birthday, full street address, emergency contacts and references. CV uploads preserve the chosen application CV and return their exact new workspace revision so unsaved profile input is retained.

Geocoder is none by default. The optional Google adapter requires separate approval/configuration; the Nominatim adapter requires an approved private instance. The public OSM Nominatim service is deliberately rejected for personal address queries in accordance with its policy; no autocomplete or background lookups were added. User opt-in and an explicit query/selection are required when an administrator later configures a provider. No provider, billing, location permission or actual address transmission was enabled in this task. Manual entry remains available.

Six targeted tests passed for sensitive defaults/strength, blank-only CV prefill, phone normalization, nullable country facts, disabled/public-provider guards and recorded geocoder parsing. TypeScript and production build passed. Local fictional browser saved an optional employment-status value and two role preferences, verified both and resumed the preference step after reload; no page overflow at 375/1280px. No real personal profile was edited, geolocation/device permission activated or employer application sent. Protected sign-in/auth/shared sign-in styles have no diff. Site v88 excludes this checkpoint pending rollout. Prompts 14–17 remain unfinished.

## Checkpoint 14 evidence

Added private in-app notification preferences for six categories, read/dismiss controls, receipt-honest application updates, scan availability, saved-job/interview reminders and keyword-match digests. Items are idempotent and dismissed/disabled digests do not become unread on refresh. Digests/reminders refresh through app activity and successful authorized source-worker refreshes; there is no new cloud scheduler. Email/push are visibly inactive because this architecture has no configured SMTP/VAPID delivery. No external messages, subscriptions or browser notification grants were activated. A post-sign-in PWA manifest and dormant no-cache push worker are prepared; they do not register or request permission automatically. Actual outbound delivery remains a separately configured integration rather than a false “sent” result.

Help includes FAQ-grounded central/basic chat, bounded private support drafts and feedback, dated changes, configurable support mailto, version/email footer, private Markdown privacy/internal-terms pages and tutorial/sample links. Existing account deletion/sign-out/security helpers are reused unchanged; local-cache reset only removes CyberApply preference keys and preserves auth/session keys. Export now streams all owner career records/versions and workspace history without write tokens, preserving bounded memory and avoiding stale claims that no submission integration exists. Files are referenced in this records export and remain individually downloadable. Inbox shows application links, an Interviews filter and user-controlled link/unlink metadata; it never changes Gmail or treats manual links as receipt evidence. Live inbox relinking remains untested because no new Gmail consent was granted in QA.

Nine notification/Help/export/inbox tests passed, including a SQLite two-owner export test, uncertain-state wording, score thresholds and disabled/dismissed digests. TypeScript and production build passed. Local fictional browser saved/reloaded a 75% alert threshold, verified email inactive, asked Help about the tracker, saved a support draft with an explicit “not sent” notice and downloaded valid JSON containing 54 career records, 18 career versions and 60 history entries, with the same nine application fixtures. Help at 375/768px had no page overflow. No real application, email, location/device permission or paid service activated. Protected sign-in/auth files remain unchanged. Prompts 15–17 remain unfinished; live Site v88 excludes prompts 13–14 pending rollout.
