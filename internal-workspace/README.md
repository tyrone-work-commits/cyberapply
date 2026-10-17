# CyberApply — Covenda internal workspace

This is a private, mobile-responsive CV and job-application workspace with shared agent tools. It uses existing ChatGPT identity and Sites hosting. Five themes remain available throughout account entry, profile setup and the workspace.

## Current journey

Sign in / Create account → save your account profile → open your own workspace → review candidate facts and CV → add a sourced job listing → swipe left to pass or right to **Apply** → view the saved request and its next action in Applications.

The demo has been removed from the application: no demo choice, seeded candidate, sample-job generator, simulated sending, simulated receipts or demonstration agent tools remain. Old workspace URLs redirect to `/workspace`; APIs reject the retired `mode=demo` scope with 410. Existing stored historical demo records are inaccessible through the app and have not been destructively purged. Legacy sample records are filtered from owned current/history/export views. Real personal records and saved versions remain available.

## LinkedIn and real application status

The requested target is real LinkedIn vacancies in Explore and actual submission after a right swipe. **This target is not yet delivered.** On 17 October the user said Covenda has no known approved LinkedIn job-data/application provider or partner access and requested that this dependency be recorded in Linear (FDE-26/FDE-27).

The current release accepts an original public HTTPS LinkedIn or employer listing URL and the details supplied by the user/agent. It does not fetch LinkedIn pages, search live jobs, connect a member account or submit to employers. A public listing is not an application integration.

Right swipe and the visible **Apply** button now record an owner-specific request and exact candidate/application-text snapshot. Without a connected service it has `status: needs_action` and `reason: connection_required`. Repeating Apply does not duplicate requests or materials. Editing the CV, importing TXT or editing application text flags changed materials while preserving the requested snapshot. There is no fabricated Submitted/Applied success state. Opening the original application page is a manual fallback and never records proof of submission. Only pass decisions offer a five-second Undo.

No new paid services, account permissions or external submissions were configured. An approved live integration still needs source attribution, authorization, supported application routes, truthful answers, exact-material consent, duplicate prevention and verified submission evidence. Do not claim that LinkedIn's employer/ATS partner APIs provide arbitrary job-seeker auto-apply access.

## CV review and saved records

CV review explains six deterministic text checks: identity/contact, section headings, measurable impact, action bullets, declared skills and length/bullets. Scores are not ATS results or hiring predictions. UTF-8 TXT imports text; PDF/DOCX uploads are privately stored but not parsed. Paste their text for review. File limit: 5 MB.

Sites supplies authenticated identity. D1 stores owner-scoped workspaces and immutable revisions; R2 stores private uploads. Writes require the current revision and cannot overwrite a newer save. All agent operations use the authenticated visitor's own workspace. The 14 current MCP tools include CV review, listing/draft operations and `get_application_requests`; old simulation/example tools are unavailable. Agent activity and UI activity use the same durable records.

## Verification — 17 October 2026

- TypeScript passed and the production Vinext build completed.
- 68 local automated checks passed: 14 domain, 19 HTTP/storage, 9 MCP, 13 onboarding and 13 live-workspace acceptance checks. All fixtures and dispatch identities were loopback-only.
- Browser checks covered account entry without demo promotion, a single saved workspace choice, sourced listing input, right-swipe Apply at desktop and 320px width, an unsent request, editing and persistence after refresh. Explore with the Apply control and Applications had no horizontal overflow at 320px (305px content width). This was not a physical-phone test.
- Actual LinkedIn ingestion, employer delivery and submission receipts were not tested because no approved connection is configured. Hosted publication verification is recorded in the root release history and Linear after deployment.

Commands (from this directory):

```
node node_modules/typescript/bin/tsc --noEmit
node --test tests/domain.test.mjs
node scripts/run-framework.mjs build
node tests/http.test.mjs
node tests/mcp.test.mjs
node tests/onboarding.test.mjs
node tests/live-workspace.test.mjs
```

HTTP/MCP/onboarding/acceptance scripts require a compiled Worker on loopback port 8787. Local Wrangler on Windows can stall the next request after early body rejection; the HTTP suite keeps that rejection last and all requests are bounded. No mutation retry is hidden in these checks.
