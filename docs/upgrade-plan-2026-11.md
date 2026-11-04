# Sorce + Jobscan upgrade execution — 4 November 2026

Source: the user's 28-page Cyber Apply Upgrade Plan PDF. It describes the retired Next/FastAPI public prototype. Implement feature intent in the current internal Sites/Vinext/React app, authenticated through unchanged ChatGPT identity, owner-scoped D1 and private R2. Do not recreate retired authentication, demos or colour themes. Optional billing stays disabled. No paid provider, mail delivery, account connection or real application is activated by this upgrade.

## Ordered checkpoints

| Prompt | Work | State |
|---|---|---|
| 0 | Protected authentication and upgrade guardrails | Implemented; existing project rules preserved |
| 1 | Central server writing service, basic mode, quotas and status | Implemented; 6 tests, TypeScript and production build passed |
| 2 | ATS scan engine and private scan records | Implemented; 14 logic/storage/file tests, TypeScript and production build passed. PDF structure beyond fonts/page data remains explicitly unverified |
| 3 | Dashboard, match reports and history | Implemented; TypeScript/production build and local browser checks passed at 375/768/1280px. Created pasted/PDF scans, renamed, reloaded, changed history status, opened guide and highlighted keywords |
| 4 | Optimize editor and evidence-preserving suggestions | Pending |
| 5 | Resume builder, versions and exports | Pending |
| 6 | Cover letters | Pending |
| 7 | Discovery improvements and companies | Pending; swipe stack already exists |
| 8 | More supported job feeds and refresh | Pending |
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
