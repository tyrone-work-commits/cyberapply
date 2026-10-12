# CyberApply frontend

Responsive Next.js / React / TypeScript interface for the existing FastAPI backend. The layout combines a simple five-tab mobile journey with résumé review, explainable fit comparisons and an application workspace.

## Product controls added on 12 October 2026

- Explore displays trusted automatic/demo/manual availability. Automatic right swipes have a server-enforced five-second Undo hold, restored after reload. Manual roles offer the validated employer link and a review draft.
- Swipe settings can choose the best reviewed résumé per role or a manual selection. Targeted suggestions preserve the existing text and highlight only reviewed skills. New drafts must be reviewed before use.
- Role cards surface salary/currency, certifications, authorization, clearance and explanatory match checks.
- Applications → Your next steps schedules interviews and follow-ups in device-local time. The worker creates durable in-app reminders. Calendar downloads include a reminder. Push/email reminders are not connected.
- The production service worker caches only the public offline shell/icons. Account-scoped Saved listings and pending choice IDs use IndexedDB; résumés, inbox, API responses and credentials are excluded from that cache. Offline choices require explicit foreground review and current eligibility checks after reconnecting. Signing out clears the current account's offline data.
- Five themes use improved contrast; larger text is account-synced. Font sizes respond to browser text settings. Touch targets, focus, equivalent buttons/arrow keys and reduced-motion gestures are supported.
- Account & security supports local TOTP setup, one-use recovery codes, protected sign-in, private ZIP export and account deletion. Provider MFA uses trusted provider factors and fresh authentication for sensitive actions. Live provider credentials still require validation.
- Themes, text size and automatic résumé selection are stored by the API and synchronized across browsers. Installation help covers desktop/Android prompts and Safari's Add to Home Screen flow. A secure accessible deployment is needed to test actual phone installation.

Run `frontend/tests/product_controls.py` against a **production** local build with the API and worker running. It creates and deletes a fictional account, tests MFA/export/erasure and exercises offline Saved listings and pending choices. `smoke.py` covers the overall responsive journey; `swipes.py` covers gesture and worker behavior. No physical iPhone/Android or VoiceOver/TalkBack test has been performed. The user deferred selection of the first real employer connection; external submissions remain disabled locally.

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
- SORCE-inspired Explore deck: swipe left to pass, right to apply automatically with your selected reviewed résumé. Touch, mouse, keyboard arrows and Pass/Apply buttons are supported; vertical description scrolling and short/cancelled drags do not submit. Passed jobs can be restored; existing applications stay out of the deck.
- Search and Saved/Passed collections with job cards, filters, company following, manual job entry and supported public job-board imports.
- Job detail and explainable fit report; prepare an application using a reviewed résumé.
- Application review, answer / cover-letter edits, version-checked actions, submission status, activity history and manually recorded hiring outcomes.
- Inbox folders, read/star/archive, search, mailbox connection/sync, attachments, drafts and captured previews. Sent, captured, sending, failed and uncertain statuses have distinct UI states.
- Profile, preferences, automation mode/limits/pause, account verification/password controls, FAQ and private problem reports.
- **Paper, Midnight, Ocean, Forest and Ember** themes, plus device light/dark preference. Signed-in choices synchronize through the API; signup choices are saved on this browser and are available on signup, the header palette button and Profile → Appearance.
- Desktop sidebar and mobile bottom navigation, keyboard focus styles, native dialog focus trapping, reduced-motion support and scrollable small-screen forms.

## Demo and provider configuration

Choose **Explore the demo** to try fictional jobs, applications and messages without creating an account. Demo data is kept in this browser tab, separate from real accounts; it makes no employer or mailbox requests. Its PDF/DOCX upload preview requires manual text/fact entry. Actual account uploads use the backend parser. Demo application receipts and captured mail explicitly say they were not delivered.

Local email authentication works with the current backend. Google, Apple and phone authentication require configured Supabase providers. Buttons show the configuration limitation instead of pretending to sign in. Use `http://localhost:3000/auth/callback` in the backend OAuth redirect allowlist and Supabase redirect URLs. For provider confirmation/recovery, set the Supabase Site URL to `http://localhost:3000/auth/callback`; default implicit-session links are handled. Custom email templates that deliver only `token_hash` need additional backend support.

External application submission and live mailbox access follow the backend's connector settings. Public job imports do not create a universal submission connector. The current local setup captures mail and simulates demo submissions. Fit scores remain heuristic guidance.

Right swipes create one `mode: automatic` application for the displayed job; they do not enable automatic discovery of other roles. The main reviewed résumé is selected initially and can be changed in Swipe application settings. Profile confirmation, résumé review, pause state and daily limits are checked before queueing. The backend also enforces fit, preferences, required answers and connector availability. The status panel polls the worker and shows sent only after a confirmation receipt; incomplete or unsupported applications wait for attention in Applications. Demo receipts explicitly say no employer was contacted. Duplicate clicks and retries use an idempotency key, and the backend enforces one application per user/job.

Access/refresh tokens stay in session storage for the current tab. One expired access response triggers a coordinated refresh. OAuth/recovery credentials are removed from the URL before asynchronous work. Recovery tokens stay in memory and the user signs in again after a password change.

## Checks

```powershell
cd frontend
pnpm run typecheck
pnpm run build
cd ..
.\.venv\Scripts\python.exe frontend\tests\smoke.py
.\.venv\Scripts\python.exe frontend\tests\swipes.py
```

The browser smoke script uses the backend's optional Playwright dependency and installed Edge on Windows, or Playwright Chromium elsewhere. It tests signup options, all five themes, device mode, persistence, dialog scroll restoration and 40 combinations of pages/viewport widths (320, 390, 768 and 1440px). It requires both local servers.

Add `--live-registration` to exercise real local API signup, confirmed profile, preferences, reviewed main résumé and bootstrap token refresh. This creates one fictional `@example.com` QA account and refuses to run unless local authentication and captured email are enabled. Use `--url http://localhost:3001` to check another frontend port. No real email or employer contact occurs in these checks.

The swipe script checks native touch and mouse gestures, keyboard actions, cancellation, vertical scrolling, passed-job restoration, persistence, setup/limits, five themes and responsive layouts. Intercepted responses test connection failures, stable retry keys, repeated clicks, queue polling and attention states. A fictional local QA account then exercises a right swipe through the real API and worker to a confirmed demo receipt. Keep the worker running; local authentication and captured email are required.

Product-control verification: backend 157 tests, Ruff, TypeScript and production build passed. Browser checks covered Undo/reload/reaccept, targeted draft review, schedule/calendar actions, 40 theme/text-size/viewport combinations, production offline/reconnection behavior, cross-context preference sync, authenticator setup and recovery sign-in, export and deletion. Existing gesture/worker and 40 responsive page checks also passed. 100 theme text/control contrast comparisons met the tested AA thresholds. Physical device and live employer checks remain separate.
