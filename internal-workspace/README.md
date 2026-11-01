# CyberApply - internal workspace

This directory is the current deployed CyberApply app. It uses Sites/Vinext, ChatGPT identity, owner-scoped D1 records and revisions, and private R2 CV files. The existing access policy is controlled by Sites; local preview identity must never be used as production authentication. The app retains its fixed light/green appearance.

## Features

- ChatGPT sign-in/create-account entry, setup/edit profile and account settings.
- Real cybersecurity job discovery from selected public Greenhouse/Lever boards, search filters and source management. Searches are on request with a one-minute per-user cooldown.
- Explore: left to reject, right to Apply, up to save; centered Undo and ordered background saves.
- Saved jobs and Applications with the chosen original CV, agent progress, employer questions, reviewed answers, outcome evidence and deletion controls.
- CV upload, view, download, delete and deterministic ATS-style text quality guidance. This is not an employer ATS score or hiring prediction. Searchable PDF, DOCX and UTF-8 TXT are supported, with 5 MB/file and 20 saved files/account; scanned/image-only documents need a searchable export.
- Related application mail from the signed-in user's connected Gmail, matched to their application employers. Gmail authorization is separate from ChatGPT sign-in. Mail is read on request and not persisted to workspace history; an email shown is not an automatic Applied transition.
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
npm run build
```

Additional `*-http.test.mjs`, MCP, onboarding and live-workspace scripts need the compiled Worker and local fixtures; some job-source scripts perform read-only real-provider requests. Do not run every test file indiscriminately against production. Use the root Python environment for `python -m unittest discover -s application_agent/tests` from the repository root; the agent has its own Playwright dependency.

## Application agent

The hosted Worker cannot run an employer browser. The current Python runner connects through `/api/application-agent/*`, reads the exact selected CV and saved Account Profile, attempts supported bounded form repairs, and records evidence. Profile contact/location/salary/visa/work-rights facts are never invented. CV-grounded generated prose and cover letters need exact-text approval. Login, CAPTCHA, missing facts and unsupported destinations can still require user action. The computer must be awake and online for local background processing.

Applied requires a new employer confirmation. Any possibly delivered application stays Check outcome and is protected from replay. Keep the HTTP 410 old `/api/agent/*` routes and minimal duplicate-prevention records. Full operational details and policies are in [the agent guide](../docs/application-agent.md).

## Publishing

Use the Sites source helper to open the existing source repository, synchronize these files, run checks/build, commit/push and package that exact source commit, then save/deploy a new version to the same Site. Never publish `.env`, `.wrangler`, `.sites-runtime`, private originals or local connection credentials. Record the GitHub commit, Site version, checks and any live-test limits in Linear after meaningful changes. The old standalone frontend/backend and separate-host deployment instructions are no longer part of this app.
