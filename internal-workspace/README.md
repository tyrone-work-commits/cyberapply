# CyberApply — Covenda internal workspace

Private mobile-responsive CV review, real cybersecurity vacancy discovery and application-request workspace. ChatGPT identity, Sites hosting, D1 history and private R2 files are retained. Paper, Midnight, Ocean, Forest and Ember remain available throughout the app.

## Current journey

Sign in / Create account → account profile → own workspace → review CV → **Find live jobs** → inspect Greenhouse/Lever roles → swipe left to pass or right to **Apply** → review saved materials and the next action in Applications.

LinkedIn-specific links, connection prompts and feed status have been removed from the internal application. Existing personal records and their original source URLs/history are preserved. Demo flows, fabricated listings, seeded candidates and simulated receipts remain removed; retired demo APIs return 410.

## Real employer job discovery

Explore searches public employer boards through documented Greenhouse and Lever GET APIs. Initial boards: **Huntress**, **Recorded Future** and **Safe Security**. Users can manage up to five Greenhouse/Lever board URLs (including Lever EU), filter by a role-title phrase and location, and select Remote only. Remote status uses explicit vacancy location/workplace data, not company boilerplate. Remote does not imply worldwide eligibility.

Search is on request, not a scheduled background feed. Settings, per-board results and imported listings are saved per user and survive refresh; the agent uses the same records through `get_job_sources` and `discover_jobs`. There are 16 current MCP tools. Source calls send only board identifiers/pagination and do not send CVs, profile details, job-search filters or candidate credentials to providers.

Import safeguards:

- Fixed HTTPS API hosts, validated board identifiers and rejected redirects; no fetching arbitrary supplied listing URLs.
- At most five boards; 15-second per-board deadlines, 8 MB/page, bounded Lever pagination, one-minute per-user search cooldown and up to 24 new roles per search.
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

CV review explains six deterministic text checks; scores are not ATS results or hiring predictions. UTF-8 TXT imports text. PDF/DOCX uploads are privately stored but not parsed; paste text for review. File limit: 5 MB.

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
