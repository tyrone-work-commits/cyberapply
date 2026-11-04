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
