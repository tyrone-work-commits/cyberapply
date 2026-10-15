# CyberApply internal workspace

## Corrected delivery plan

This is a private Covenda tool and an agent-backed demonstration. It does not require new Vercel or Render subscriptions. The existing Next.js/FastAPI application remains a separate, preserved implementation in the CyberApply GitHub repository.

The first internal delivery lets a signed-in teammate enter and confirm their own candidate facts, save supplied job listings, compare declared skills, pass or prepare a draft with a five-second undo, edit the draft, mark it ready for manual application, and inspect/export saved history. The same records are available to the private CyberApply agent tools. It never submits applications or contacts employers.

Optional sample jobs are explicitly fictional and do not replace candidate facts. Imported listing sources are supplied by the user or agent, not automatically verified. Matching is deterministic skill coverage, not an ATS result or eligibility guarantee. No paid model API is configured; the connected ChatGPT agent can help with research/drafting using the user's existing approved tools.

## Runtime and privacy

The Sites Vinext/Workers runtime supplies ChatGPT identity. D1 stores per-user workspaces and immutable saved revisions; R2 stores private uploads. Every data operation uses the authenticated Site user ID, never a client-supplied owner ID. Concurrent writes require the current revision and cannot overwrite a newer saved version. Each accepted mutation and its snapshot are written in one D1 batch. There is no automatic local-data migration.

New Site access remains owner-private until an appropriate private review audience is configured through Sites. Site access and row ownership are separate: reviewers use their own records. No live candidate data is copied from the local SQLite database. No Google/Apple credentials, mailbox credentials or employer tokens are copied. Apple remains available in the original local application's sign-in screen; the internal Site uses ChatGPT sign-in.

PDF and DOCX uploads are stored privately but not parsed by this pilot. TXT imports its text for review. Paste reviewed résumé text for matching. Files are limited to 5 MB; record/text/listing limits are enforced. The recent activity view shows 200 events; immutable D1 revision snapshots retain earlier history. Export includes the current owned records; file contents download through authenticated per-user routes.

## Setup and checks

Use the Sites plugin's `project-setup.mjs`, `install-dependencies.mjs`, `build-site.mjs` and source workflow. `.openai/hosting.json` holds the stable Site ID and DB/BUCKET bindings. Local dev uses the starter's loopback-only mock ChatGPT identity; production auth is dispatch-owned. Local and hosted databases are separate.

Generate schema migrations with `npm run db:generate`, build once, and apply pending SQL files to local D1 using the starter README commands. Build/package/deploy through Sites. Install/connect the provisioned private CyberApply plugin to verify a real remote tool call; a deployed URL alone does not prove the plugin connection.

Tests: domain workflow tests; local HTTP tests for authentication, ownership, persistence, concurrent writes, historical revisions, private uploads and MCP discovery/actions; responsive browser checks and a live hosted persistence check. Record actual outcomes rather than assuming these checks pass.

## Demonstration

Sign in → save candidate facts → add a supplied or clearly fictional listing → explain the skill match → prepare a draft → edit/save → refresh/reopen → inspect the saved revision and history. Then use a connected agent tool to read the same record. A ready draft is not a submitted application. Employer submission, inbox integrations, automatic live job ingestion and scheduled processing are future integrations and remain unconnected here.

The full local app's additional settings, MFA, inbox, scheduling and connectors are not represented as working hosted integrations in this first internal version. No Claude connection is claimed without a successful authorized tool call.

## Verification on 15 October 2026

- TypeScript check and production Vinext build passed.
- Eight domain tests cover factual review, skill coverage, duplicate drafts, review invalidation, time-bounded Undo and source validation.
- Local compiled Worker HTTP checks cover D1 persistence/history/CAS conflicts and owner-scoped R2 uploads/downloads. MCP checks run separately from multipart-upload checks because Wrangler on Windows returned a mid-request restart on the following POST in the combined harness; no mutation retries are hidden in these tests.
- Browser checks exercised candidate save, fictional-job preparation and exact draft-text persistence after refresh. A 320-pixel viewport had no horizontal overflow on the reviewed draft screen; mobile navigation and the five-theme chooser were inspected. This is not a physical-iPhone test.
- Hosted deployment, hosted sign-in, named reviewer access and an installed remote agent call must be reported separately after native Sites verification.

Run `node --test tests/domain.test.mjs`, `node tests/mcp.test.mjs`, and `node tests/http.test.mjs` from this directory. The latter two use a separately running compiled Worker on loopback port 8787 and create only fictional QA owners/records. Never aim test identity headers at a hosted Site.
