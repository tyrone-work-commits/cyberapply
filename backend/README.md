# CyberApply backend

Backend for a cybersecurity job application app, combining SORCE's discovery, application tracking, inbox and profile flow with Jobscan-style résumé analysis and explainable matching. This directory contains the API, database, workers, integrations and tests. The responsive interface is implemented in `../frontend`; see its README for launch instructions and frontend verification.

## Product controls — 12 October 2026

Revision **792aecd432a1** adds account preferences, MFA factors/challenges, application schedules, deletion state, résumé target roles and submission holds. Migration preservation, downgrade/re-upgrade, schema checks and offline PostgreSQL DDL passed; the existing local SQLite database was backed up privately before migration. **157 backend tests passed**, including concurrency, owner isolation, MFA replay/recovery, provider factor enforcement/freshness, export/erasure, uploads during deletion and worker holds.

| API | Behavior |
| -- | -- |
| Job responses → `submission` | Server-derived capability and validated manual employer URL; no secrets or user-controlled connector permission. |
| `POST /applications` → `undo_window_seconds: 5` | Five-second server hold for automatic swipes; defaults to zero for existing callers. Workers cannot claim or process early. |
| `POST /applications/{id}/undo` | Atomically cancels only unclaimed held work; restores the role, frees quota and preserves history. Reaccept uses a fresh request key. |
| `GET /jobs/{id}/resume-recommendations` | Ranks owned, reviewed résumés against the job and preferences. |
| `POST /resumes/{id}/tailoring-preview`, `/tailor` | Version-checked factual preview and new unreviewed text draft; never invents experience or changes an existing uploaded file. |
| `/application-tasks` | Owned interview/follow-up CRUD with explicit timezone input, durable one-time in-app reminders and escaped/folded calendar exports with alarms. |
| `/account/settings` | Theme/device mode, normal/large text and automatic résumé selection synchronized through the API. |
| `/auth/mfa/*` | Encrypted local TOTP setup, replay protection, scoped expiring challenges, bounded attempts, hashed one-use recovery codes and session revocation. Provider verification uses authoritative factor state. |
| `POST /account/export` | Streams a private ZIP containing owned data/files; excludes authentication and connection secrets. Requires password plus a new factor proof when enabled, or recent provider authentication. |
| `DELETE /account` | Requires explicit confirmation and fresh proof; disables sessions/work first, then erases owned records/files. Returns pending when active I/O or storage prevents completion; the worker retries. |

Erasure retains a minimal inactive user identifier to block old provider tokens from recreating an account. It cannot retract applications already delivered to employers or delete external Google/Apple identities. Worker adapters renew their leases during live I/O; expired submissions receive a grace period before crash recovery. Failed document deletion retains its storage key for retry/erasure. Export and deletion do not touch another user's data.

The first live employer connection is deferred at the user's request. No live employer submission, provider credential validation, PostgreSQL runtime deployment or physical-phone installation is claimed by these checks.

## Start locally on this computer

The project virtual environment is already installed at `../.venv`. From the project directory, open two PowerShell terminals:

```powershell
# Terminal 1: API, including database migrations
& .\backend\scripts\start-backend.ps1
```

```powershell
# Terminal 2: durable application queue and automatic discovery
& .\backend\scripts\start-worker.ps1
```

The API listens on `http://127.0.0.1:8000`. Interactive API documentation is at [Swagger](http://127.0.0.1:8000/docs), with [ReDoc](http://127.0.0.1:8000/redoc) and [OpenAPI JSON](http://127.0.0.1:8000/openapi.json) available. `/health` checks the process; `/health/ready` checks database access. Stop either process with Ctrl+C. No frontend is required to inspect or test the backend.

Local defaults use SQLite, private local files, captured authentication messages and simulated mail delivery. No employer submissions happen unless external integrations are explicitly enabled. Configuration is read from `backend/.env`; `.env`, databases, documents and captured tokens are excluded from Git.

To populate fictional cybersecurity listings, from `backend`:

```powershell
& '..\.venv\Scripts\python.exe' -m app.cli seed-demo
```

These six shared listings use a local demo connector. Their application confirmations are clearly marked as simulations. Repeating the command does not duplicate listings. It does not create user accounts. Demo seeding and submission are disabled in production.

## Reinstall dependencies

Requires Python 3.12 or newer. From the project directory:

```powershell
python -m venv .venv
& '.\.venv\Scripts\python.exe' -m pip install -r .\backend\requirements.lock
& '.\.venv\Scripts\python.exe' -m pip install --no-deps -e .\backend
Copy-Item .\backend\.env.example .\backend\.env
```

Use a generated `JWT_SECRET` and Fernet `ENCRYPTION_KEY` for your own environment. Generate values without committing them:

```powershell
& '.\.venv\Scripts\python.exe' -c 'import secrets; print(secrets.token_urlsafe(48))'
& '.\.venv\Scripts\python.exe' -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
```

Keep the encryption key stable: changing it makes previously stored mailbox credentials unreadable. Python dependency versions are pinned in `requirements.lock`; the browser executable is a separate runtime.

## Connect Google and Apple sign-in

The local app can use hosted Supabase **only for authentication** while the API, SQLite database and uploaded files stay on this computer. Google and Apple use the same buttons for creating an account and returning to an existing account. The verified provider identity creates the CyberApply profile, preferences and automation records on first sign-in; existing provider users reuse those records.

1. Open [Supabase Dashboard](https://supabase.com/dashboard), sign in privately, create a project named **CyberApply** in your organization, and save the database password privately. Connect the Supabase plugin in Codex if you want help configuring the project. An unconnected plugin does not give Codex access to the account.
2. In Supabase **Authentication → URL Configuration**, set Site URL to `http://localhost:3000`. Add these exact redirect URLs:
   - `http://localhost:3000/auth/callback`
   - `http://127.0.0.1:3000/auth/callback` if you also use that address.
   Use the same hostname and browser tab from starting sign-in through returning to the app. The local PKCE attempt expires after ten minutes; provider authorization codes have their own shorter lifetime and are single-use.
3. For **Google**, create a Web application OAuth client in [Google Auth Platform](https://console.cloud.google.com/auth/overview). Configure the consent screen, `openid`, email and profile scopes, and test users if the consent audience is in testing. Add `http://localhost:3000` as an authorized JavaScript origin. Add the **Supabase** callback `https://<project-ref>.supabase.co/auth/v1/callback` as the authorized redirect URI. Paste the client ID and secret privately into Supabase **Authentication → Sign In / Providers → Google**, and enable it. The provider callback and the app callback are different URLs. [Official Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google).
4. For **Apple**, use an Apple Developer account: enable Sign in with Apple on the App ID, create a Services ID for the website, register the Supabase project domain and its HTTPS `/auth/v1/callback` return URL, then create a signing key and generate the Apple client secret. Enter the Services ID and client secret privately in Supabase's Apple provider configuration and enable it. Put the Services ID first if native App IDs are also listed. Apple's web OAuth secret needs renewal every six months; keep the signing key private. [Official Apple setup](https://supabase.com/docs/guides/auth/social-login/auth-apple). Apple returns through hosted Supabase, which redirects back to the local app.
5. Configure the project's ignored `backend/.env` privately:

   ```dotenv
   AUTH_MODE=supabase
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=<project-publishable-or-legacy-anon-key>
   OAUTH_REDIRECT_URLS=["http://localhost:3000/auth/callback","http://127.0.0.1:3000/auth/callback"]
   ```

   Use a project with an asymmetric JWT signing key (ES256/RS256); CyberApply retrieves public verification keys from Supabase. For an older project still issuing HS256 JWTs, `SUPABASE_JWT_SECRET` must also be set privately on the backend. A service-role/secret key is **not** needed for Google or Apple sign-in and must never be used as the anon key. Google/Apple secrets belong in Supabase, never the frontend, chat, GitHub or Linear. Keep the existing CyberApply `JWT_SECRET` and `ENCRYPTION_KEY` stable.
6. Restart the API and worker so they read the same authentication configuration. Check `GET /api/v1/auth/capabilities`: enabled providers report `true` and `providers.<name>: "ready"`. `not_configured`, `disabled` and `unavailable` distinguish missing setup, a disabled provider and a temporary service failure. Readiness checks do not prove that client secrets or all console redirects are correct; complete the real sign-in checks below.

**Existing local email accounts:** switching `AUTH_MODE` changes the identity authority. Local email/password accounts and their data are not automatically migrated or linked to provider identities. The API rejects a provider identity whose email already belongs to a different local user, rather than exposing that user's data. Back up the SQLite database/private storage and plan an authenticated migration before switching an installation with real accounts. For the first live provider test, use an email not already registered locally. Do not delete accounts or merge identities merely to bypass a conflict. Changing `AUTH_MODE` back to `local` restores the original local authority; it does not undo provider accounts created externally.

**Live acceptance checks:** test Google and Apple first-time account creation and returning sign-in; provider cancellation; a second factor if enabled; refresh after the access token expires; logout; account confirmation and password recovery for provider email accounts. Confirm one CyberApply user/profile per verified provider ID and no credentials left in callback URLs. Apple Hide My Email addresses are accepted as provider identities. The app requests sign-in identity access, not mailbox access. Provider signup must be allowed in Supabase for new users to create accounts. Phone/SMS setup is separate.

Local automated OAuth checks simulate provider responses without contacting Google or Apple. Real console configuration and sign-in must still be verified using your own connected project.

## User journey and API

All personal endpoints require `Authorization: Bearer <access_token>`. Paths below are relative to `/api/v1`. Swagger documents request fields; `openapi.json` is the saved frontend contract. Resource IDs are UUIDs, dates represent UTC, list endpoints paginate, and another user's resources return 404. Validation responses omit submitted secrets.

| Stage | API | Behavior |
| --- | --- | --- |
| Create account / sign in | `/auth/capabilities`, `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` | Email/password locally; Google, Apple and phone through configured Supabase Auth. Passwords use Argon2; local refresh tokens rotate and logout revokes sessions. |
| Verify / recover | `/auth/email/request-verification`, `/auth/email/verify`, `/auth/password/request-reset`, `/auth/password/reset`, `/auth/password` | One-time verification/reset tokens; generic reset request response; password changes revoke local sessions. |
| Confirm profile | `GET/PUT /profiles/me` | Skills, certifications, experience, education, links, clearance and work authorization. User confirmation is required before applications. |
| Set job preferences | `GET/PUT /preferences/me` | Roles, locations, work mode, seniority, salary, keywords and excluded companies. Unknown eligibility details are surfaced. |
| Upload and review résumé | `/resumes/upload`, `/resumes`, `/{id}/review`, `/{id}/select` | PDF/DOCX/TXT extraction with bounds, manual review, versions, main résumé selection and private downloads. Changing text detaches the original file to prevent a stale upload. |
| Review résumé fit | `/resumes/{id}/analysis`, `/resumes/{id}/optimize`, `/jobs/{id}/match` | Explainable keyword and structure checks, missing skills/certifications and recommendations. Scores are heuristics, not ATS guarantees or hiring probabilities. Recommendations do not fabricate experience. |
| Explore / search jobs | `/jobs`, `/jobs/import`, `/jobs/import/source`, `/companies` | Search/filter listings, manual import, fixed-host Greenhouse/Lever listing imports. Importing a listing does not grant application access. |
| Save / pass / follow | `/jobs/{id}/save`, `/jobs/{id}/pass`, `/jobs/saved`, `/companies/following` | Owner-specific decisions and followed companies. Passed jobs are excluded from automatic discovery. |
| Prepare applications | `POST /applications` | Captures résumé version, profile, file checksum and fit report; durable processing happens in the worker. `Idempotency-Key` and one application per user/job prevent duplicate requests. |
| Review and submit | `/applications/{id}`, `/{id}/approve`, `/{id}/cancel` | Missing answers require attention; review mode pauses for approval. Optimistic versions protect concurrent edits. |
| Track progress | `/applications`, `/applications/summary`, `/{id}/events`, `/{id}/outcome` | Ordered timeline and confirmed submission receipts. Interview/offer/rejected/withdrawn outcomes are recorded manually and retain submission history. |
| Control automation | `GET/PATCH /automation`, `GET /integrations` | Review is default; automatic mode is explicit opt-in. Pause, UTC daily limit, minimum fit, verified email for external submissions and supported connectors govern processing. |
| Handle uncertainty | `/applications/{id}/retry`, `/{id}/reconcile` | Confirmed failures can retry within the attempt limit. Unknown outcomes require receipt lookup rather than another submission. |
| Inbox and drafts | `/inbox/messages`, `/inbox/summary`, `/inbox/connections`, `/inbox/drafts` | Categorized messages, unread counts, starring/archive, encrypted mailbox connections, bounded sync, drafts, attachments and idempotent sending. |
| Notifications / support | `/notifications`, `/support/faq`, `/support/problems` | Read state, application alerts, FAQs and private support reports. |

The lifecycle is:

`queued → preparing → needs_review / needs_attention → ready → submitting → applied`

It can also reach `failed`, `cancelled` or `uncertain`. `applied` requires a valid confirmation from the configured connector. Immutable application snapshots protect queued submissions from later résumé/profile edits. Before submission, the worker also checks current preferences, eligibility, quota, pause state and job availability.

Automatic mode scans existing accessible listings while the worker runs, selects eligible jobs against explicit preferred roles and other saved preferences using the reviewed main résumé, and respects quota and passed/duplicate jobs. Scans are bounded and retain progress across restarts. Passing a discovered job stops its pending automatic submission; switching to review or clearing preferred roles requires review of pending discovered applications. Import additional listings through the API. This backend does not crawl every job board or guarantee support for every employer form.

Explore right swipes explicitly queue the displayed job with `mode: automatic`, without changing the global discovery setting. All submission checks above still apply. `GET /jobs?exclude_handled=true` omits only the current user's passed jobs and existing applications before pagination; saved roles and normal search remain available.

### Local email account walkthrough

1. `POST /auth/register` with `email` and a password of 12–128 characters.
2. With `AUTH_EMAIL_MODE=capture`, read the private JSON in `backend/data/auth-outbox` and pass its token to `POST /auth/email/verify`. Captured tokens are developer artifacts; no public endpoint exposes them.
3. `POST /auth/login`, then use the access token in Swagger's **Authorize** dialog.
4. Confirm `/profiles/me`, set preferences, upload a résumé, review its current version and select it as the main résumé.
5. Create a review application for a fictional job, let the worker prepare it, approve it and let the worker record the simulated confirmation. Alternatively opt into automatic mode after setting explicit preferences.

Image-only PDFs require manual text/profile input. Parsing extracts document content; applicants must confirm facts before using them.

## Google, Apple and phone authentication

Set `AUTH_MODE=supabase`, `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Enable and configure Google/Apple providers and the SMS provider in your own Supabase project. Add the future frontend callback to both the provider configuration and `OAUTH_REDIRECT_URLS`. Supabase may run locally with its own Docker-based stack or use a hosted development project.

`POST /auth/oauth/{google|apple}/start` accepts an allowlisted `redirect_url` and PKCE `code_challenge`, then returns an authorization URL. The frontend will generate and retain a verifier, follow the provider flow, and pass the returned code and verifier to `/auth/oauth/exchange`. Phone uses `/auth/phone/request-code` and `/auth/phone/verify` with E.164 phone numbers. The backend validates issuer, audience, signature, role and expiry of provider-issued tokens; it does not impersonate these providers locally.

Modern Supabase signing keys are read from JWKS and cached. `SUPABASE_JWT_SECRET` supports legacy HS256 projects. `SUPABASE_SERVICE_KEY` is only needed for private Supabase document storage and must stay server-side. Set `STORAGE_BACKEND=supabase` and create a **private** `SUPABASE_STORAGE_BUCKET` to use that adapter.

Provider protocol behavior has automated tests. Live Google/Apple login, SMS delivery and Supabase storage require project credentials and have not been exercised on this computer. Existing local identities are not automatically merged into a new provider identity.

## Employer integrations

The hosted Site's former local application agent and pairing bridge have been removed; see [the application-agent status](../docs/application-agent.md). This FastAPI backend retains generic, opt-in browser-form integration code for development, but it is not connected to the hosted Site. Its cover-letter helper uses confirmed profile skills shared with a listing and makes no unsupported experience claims. External submission remains off by default.

External submission is off by default. A server administrator must configure and validate each employer integration, then assign its connector to trusted job records. Public job import requests cannot assign a submission connector. Arbitrary job URLs are not automatically executable forms. After configuring the registry/webhook, use the server-only CLI from `backend`:

```powershell
& '..\.venv\Scripts\python.exe' -m app.cli configure-job --job-id YOUR_JOB_UUID --connector webhook
& '..\.venv\Scripts\python.exe' -m app.cli configure-job --job-id YOUR_JOB_UUID --connector browser_form --browser-key employer-form
# Remove support for future/pending submissions:
& '..\.venv\Scripts\python.exe' -m app.cli configure-job --job-id YOUR_JOB_UUID --connector unsupported
```

Assignment validates trusted settings without contacting an employer and can be staged while external submission is disabled. Fictional jobs cannot be converted into live integrations. Changing/removing a job's connector blocks queued submissions that captured the previous connector; it never rewrites their snapshots.

### Signed webhook connector

Configure `ALLOW_EXTERNAL_SUBMISSIONS=true`, `WEBHOOK_CONNECTOR_URL`, a strong `WEBHOOK_CONNECTOR_SECRET`, and an exact `CONNECTOR_ALLOWED_HOSTS` list. The endpoint must use HTTPS; redirects are disabled. Trusted jobs use `connector_key=webhook`.

The worker POSTs JSON with `operation: submit|status`, `application_id`, `idempotency_key`, job details and captured application materials. Requests carry `Idempotency-Key` and `X-JobApp-Signature: sha256=<HMAC-SHA256 of exact body bytes>`. The receiver must deduplicate by the idempotency key.

Responses use the same signature header over their exact body bytes and echo `application_id`. Successful receipt:

```json
{"application_id":"the-requested-uuid","status":"confirmed","confirmation_id":"employer-receipt"}
```

`status=not_submitted` is a confirmed safe failure. Unsigned, mismatched, unreadable, redirected or ambiguous results become `uncertain`. The `status` operation looks up the previous receipt without applying again.

### Configured browser forms

Set `BROWSER_CHANNEL=chromium`, `msedge` or `chrome`. The connector launches an isolated headless browser; it does not use personal browser profiles. Chromium can be installed from `backend`:

```powershell
& '..\.venv\Scripts\python.exe' -m playwright install chromium
```

On this computer, installed Edge passed the intercepted form test. Chromium's download timed out, so set `BROWSER_CHANNEL=msedge` for local configured browser forms. Set `ALLOW_EXTERNAL_SUBMISSIONS=true`, an exact allowed host list and a one-line JSON `BROWSER_CONNECTOR_CONFIG`. Example registry entry:

```json
{
  "employer-form": {
    "origins": ["https://employer.example"],
    "path_prefixes": ["/apply/"],
    "fields": {
      "full_name": {"selector":"#name","type":"text","required":true},
      "email": {"selector":"#email","type":"text","required":true},
      "resume": {"selector":"#resume","type":"file","required":true}
    },
    "submit_selector": "#submit",
    "confirmation_selector": "#success",
    "confirmation_text": "Application submitted",
    "receipt_selector": "#receipt"
  }
}
```

Trusted jobs use `connector_key=browser_form` and `attributes.browser_connector_key=employer-form`. Select fields can map explicit `values`; checkbox answers require booleans. Optional settings include `receipt_attribute`, `status_url_template` containing `{application_id}`, `resource_hosts`, and `captcha_selector`. The allowlist applies to navigation and requests. Uploads verify the captured document owner and checksum. Missing answers, unsupported selectors and CAPTCHA require attention; the connector does not bypass CAPTCHA. Ambiguity after clicking Submit is treated as uncertain.

No real employer was contacted during implementation. The browser test intercepts all requests to a fictional employer and checks the actual DOM, submission and receipt handling.

## Mail integrations

`MAIL_MODE=demo` captures draft delivery without sending. Mail connection APIs accept Gmail, Microsoft or Yahoo and use fixed TLS IMAP/SMTP hosts, encrypted credentials and owner checks. `MAIL_MODE=smtp` enables real provider transport when valid provider-approved credentials are configured. IMAP synchronization deduplicates messages with UID/UIDVALIDITY tracking and conservatively links application mail.

Mailbox access is separate from signing in with Google/Apple. OAuth-only mailbox environments need a provider mail OAuth integration; this version supports app passwords/provider-approved SMTP and IMAP credentials. SMTP does not supply universal delivery receipts: a timeout after sending is reported as `delivery_unknown`, with blind retries prevented. Sending drafts requires an `Idempotency-Key`. No real mail was sent during development.

For local email registration/reset delivery, set `AUTH_EMAIL_MODE=smtp` and the server-side `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` and `SMTP_FROM`. Supabase mode uses the project's own authentication message configuration.

## Database, workers and containers

Schema changes live in Alembic migrations. From `backend`:

```powershell
& '..\.venv\Scripts\python.exe' -m alembic upgrade head
& '..\.venv\Scripts\python.exe' -m alembic check
& '..\.venv\Scripts\python.exe' -m app.workers --once
```

The Windows-compatible database worker is sufficient for local development. Expiring database claims and optimistic updates coordinate processing; the database is the source of truth. Multiple workers must share the same database and document storage. SQLite is for local development; use PostgreSQL for deployment.

Optional Redis/Celery processing uses `WORKER_BACKEND=celery` and `REDIS_URL`. In separate terminals from `backend`:

```powershell
& '..\.venv\Scripts\celery.exe' -A app.workers:celery_app worker --pool=solo --loglevel=info
& '..\.venv\Scripts\celery.exe' -A app.workers:celery_app beat --loglevel=info
```

Beat enqueues a durable drain every five seconds. Prefer the provided Linux containers for Celery deployment. The default Compose stack uses the database worker and includes Redis for the optional Celery configuration.

`compose.yaml` provides PostgreSQL 17, Redis 7, API and worker services with persistent database/documents volumes and health checks. After installing Docker, copy `.env.example` to `.env`, generate secrets, set a URL-safe `POSTGRES_PASSWORD` and run from `backend`:

```powershell
docker compose up --build -d
```

Set `INSTALL_BROWSER=true` to include Chromium and Linux dependencies in the image when configured browser forms are needed. The default image does not download a browser. Compose applies migrations before the API starts and the worker waits for a healthy API.

Docker is not installed on this computer; the stack has been structurally reviewed, but its PostgreSQL/Redis runtime has not been launched here. Production settings enforce PostgreSQL, configured Supabase authentication, HTTPS frontend origins, secret keys and non-captured authentication email. Production also requires deployment-specific backups, shared rate limiting at the reverse proxy and working provider credentials.

## Verification and frontend handoff

From `backend`:

```powershell
& '..\.venv\Scripts\python.exe' -m pytest -q
& '..\.venv\Scripts\python.exe' -m ruff check app tests migrations
& '..\.venv\Scripts\python.exe' -m app.cli export-openapi --output openapi.json
```

Tests cover account/token security, tenant isolation, document parsing, profile confirmation, preferences, matching, job imports, application snapshots and transitions, quota/duplicate protection, browser/webhook receipts, inbox/drafts, notifications and support. An integrated API journey checks registration through a confirmed fictional application and interview tracking. External APIs use mocks; the browser fixture is fully intercepted.

Latest local verification (2026-10-11): **138 tests passed**, Ruff passed, Alembic schema check passed at revision `1c59d9862ace`, the standalone worker completed a drain, and live local HTTP checks passed for readiness and API documentation. Fresh/legacy migration upgrades, a downgrade/re-upgrade, and offline PostgreSQL DDL were also checked. Provider credentials and a running PostgreSQL/Docker environment remain separate integration prerequisites.

Swipe integration verification (2026-10-12): **139 tests passed**, including owner-specific handled-job filtering and correct totals/pagination. Ruff passed and the OpenAPI contract was refreshed. This change requires no schema migration.

The responsive frontend maps Explore, Search, Applications, Inbox and Profile to these APIs. It presents review/attention/uncertain states, distinguishes simulated applications and captured mail, retains PKCE verifiers during authentication, and asks users to confirm extracted résumé facts. See `../frontend/README.md` for the five themes, local launch commands and browser checks. The backend verification above records the completed backend-first handoff; the frontend was built afterward.
