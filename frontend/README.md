# CyberApply frontend

Responsive Next.js / React / TypeScript interface for the existing FastAPI backend. The layout combines a simple five-tab mobile journey with résumé review, explainable fit comparisons and an application workspace.

## Run locally on Windows

The dependencies are already installed in this workspace. Keep the backend and worker running in their own terminals; then run this from the project root:

```powershell
.\frontend\scripts\start-frontend.ps1
```

Open **http://localhost:3000**. Stop the foreground server with Ctrl+C. The script uses an installed Node.js runtime or the bundled Codex runtime on this machine. For a fresh checkout, install Node.js 20.9+ and pnpm, then run `pnpm install --frozen-lockfile` inside `frontend`.

The Next.js server forwards `/api/v1/*` to `http://127.0.0.1:8000`. Set `BACKEND_URL` in `frontend/.env.local` to use a different backend. This setting is server-side; provider credentials remain in the backend. Restart Next.js after changing it.

For a production build served locally:

```powershell
cd frontend
pnpm run build
cd ..
.\frontend\scripts\start-frontend.ps1 -Production
```

Backend setup and worker commands are in [the backend README](../backend/README.md). No hosting deployment has been performed.

## Features

- Signup / sign-in with email, Google, Apple or phone; password visibility, local password recovery, provider callback and provider recovery session support.
- Guided profile confirmation → job preferences → résumé upload or text creation → candidate fact review. Résumé versions, main selection, download and content analysis are connected to the API.
- Explore and Search with job cards, filters, save/pass, company following, manual job entry and supported public job-board imports.
- Job detail and explainable fit report; prepare an application using a reviewed résumé.
- Application review, answer / cover-letter edits, version-checked actions, submission status, activity history and manually recorded hiring outcomes.
- Inbox folders, read/star/archive, search, mailbox connection/sync, attachments, drafts and captured previews. Sent, captured, sending, failed and uncertain statuses have distinct UI states.
- Profile, preferences, automation mode/limits/pause, account verification/password controls, FAQ and private problem reports.
- **Paper, Midnight, Ocean, Forest and Ember** themes, plus device light/dark preference. Choices are stored per account on this browser and are available on signup, the header palette button and Profile → Appearance.
- Desktop sidebar and mobile bottom navigation, keyboard focus styles, native dialog focus trapping, reduced-motion support and scrollable small-screen forms.

## Demo and provider configuration

Choose **Explore the demo** to try fictional jobs, applications and messages without creating an account. Demo data is kept in this browser tab, separate from real accounts; it makes no employer or mailbox requests. Its PDF/DOCX upload preview requires manual text/fact entry. Actual account uploads use the backend parser. Demo application receipts and captured mail explicitly say they were not delivered.

Local email authentication works with the current backend. Google, Apple and phone authentication require configured Supabase providers. Buttons show the configuration limitation instead of pretending to sign in. Use `http://localhost:3000/auth/callback` in the backend OAuth redirect allowlist and Supabase redirect URLs. For provider confirmation/recovery, set the Supabase Site URL to `http://localhost:3000/auth/callback`; default implicit-session links are handled. Custom email templates that deliver only `token_hash` need additional backend support.

External application submission and live mailbox access follow the backend's connector settings. Public job imports do not create a universal submission connector. The current local setup captures mail and simulates demo submissions. Fit scores remain heuristic guidance.

Access/refresh tokens stay in session storage for the current tab. One expired access response triggers a coordinated refresh. OAuth/recovery credentials are removed from the URL before asynchronous work. Recovery tokens stay in memory and the user signs in again after a password change.

## Checks

```powershell
cd frontend
pnpm run typecheck
pnpm run build
cd ..
.\.venv\Scripts\python.exe frontend\tests\smoke.py
```

The browser smoke script uses the backend's optional Playwright dependency and installed Edge on Windows, or Playwright Chromium elsewhere. It tests signup options, all five themes, device mode, persistence, dialog scroll restoration and 40 combinations of pages/viewport widths (320, 390, 768 and 1440px). It requires both local servers.

Add `--live-registration` to exercise real local API signup, confirmed profile, preferences, reviewed main résumé and bootstrap token refresh. This creates one fictional `@example.com` QA account and refuses to run unless local authentication and captured email are enabled. Use `--url http://localhost:3001` to check another frontend port. No real email or employer contact occurs in these checks.
