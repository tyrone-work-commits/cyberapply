# Backend implementation contract

Backend only. FastAPI, Pydantic 2, SQLAlchemy 2 synchronous ORM. Routers exported as `router` and mounted by main at `/api/v1`; each domain declares its own path e.g. `/profiles/me`, `/jobs`, `/applications`. See README.md for setup and integration requirements and openapi.json for request schemas.

Core imports:
- `app.core.config.get_settings()` returns cached Settings.
- `app.core.db.Base`, `get_db()` dependency yielding Session, `SessionLocal`, `migrate_db()`; `init_db()` is for isolated tests. Deployed schemas use Alembic history.
- `app.core.security.get_current_user` dependency returns `app.models.User`; `SecretBox().encrypt(str)` / `.decrypt(str)` use Fernet.
- `app.core.time.utcnow()` returns naive UTC datetime (DB dates are UTC).
- `app.core.errors.fail(status, code, message)` raises HTTPException detail `{code,message}`.
- `app.core.storage.Storage()` methods `put(key, bytes, content_type)`, `get(key)->bytes`, `delete(key)`; local private path or configured Supabase Storage. Key generated server-side. `.get` returns bytes, never expose paths.

IDs are UUID strings. JSON fields default dict/list and must be reassigned rather than mutated in place. No relationships needed. Owner checks return 404 for another user's IDs. All timestamps naive UTC. Finite bounded inputs, strict schemas (`extra='forbid'`), limit <=100, offset >=0. SQLAlchemy commit at route/service boundary. No secrets/internal paths in API outputs.

Explore uses `GET /jobs?exclude_handled=true` to remove only the current user's passed jobs and jobs with an existing application, before totals and pagination. Saved jobs remain discoverable. Default job lists and other users' decisions are unaffected. A right swipe calls `POST /applications` with the selected reviewed résumé, `mode: automatic` and a stable idempotency key. This explicit job choice does not change global discovery mode. Requests queue work; `applied` still requires a connector confirmation from the worker.

Models (root implements these exact names/fields; additional fields require coordination):
- User: id,email(nullable unique),phone(nullable unique),password_hash(nullable),active(bool true),email_verified(bool false),token_version(int 0),revoked_before(int 0 provider-session cutoff),created_at
- Profile: user_id(PK/FK User),data(JSON dict),confirmed(bool false),updated_at
- Preferences: user_id(PK),data(JSON dict),updated_at
- Document: id,user_id,kind(str),filename,content_type,storage_key,size_bytes,sha256,created_at
- Resume: id,user_id,document_id(nullable FK Document),title,extracted_text(Text),profile_data(JSON dict),reviewed(bool false),is_main(bool false),version(int 1),created_at,updated_at
- Job: id,owner_id(nullable: null = shared public job),source(str),source_id(str),title,company,description(Text),location,remote(bool),employment_type(str),level(str),salary_min(nullable float),salary_max(nullable float),currency(str USD),required_skills(JSON list),required_certifications(JSON list),attributes(JSON dict),source_url(str),apply_url(str),connector_key(str default unsupported),is_demo(bool false),active(bool true),created_at,updated_at,expires_at(nullable datetime). Unique(owner_id,source,source_id); import service additionally handles shared-job deduplication where owner_id is null.
- SavedJob: id,user_id,job_id,decision(str saved/passed),created_at; unique(user_id,job_id)
- CompanyFollow: id,user_id,company,created_at; unique(user_id,company)
- AutomationSettings: user_id(PK),mode(str review),paused(bool false),daily_limit(int 10),min_match_score(int 60),discovery_checked_at(nullable),discovery_cursor(JSON dict),updated_at
- Application: id,user_id,job_id,resume_id,mode(str review),status(str queued),outcome(nullable interview/offer/rejected/withdrawn),resume_snapshot(JSON dict),answers(JSON dict),cover_letter(Text default empty),match_snapshot(JSON dict),missing_fields(JSON list),connector_key(str),confirmation_id(nullable),error_code(nullable),error_message(nullable Text),attempts(int 0),idempotency_key(str unique),version(int 1 ORM optimistic lock),claim_token(nullable),claim_until(nullable datetime),submission_started_at(nullable datetime),created_at,updated_at,submitted_at(nullable datetime). unique(user_id,job_id). SQLAlchemy version_id_col version.
- ApplicationEvent: id,application_id,user_id,event_type(str),from_status(nullable),to_status(nullable),message(Text),data(JSON dict),sequence(int ordered per application, unique with application_id),created_at
- MailConnection: id,user_id,provider(str),email,imap_host,smtp_host,imap_port(int 993),smtp_port(int 465),secret_encrypted(Text),active(bool true),last_synced_at(nullable),sync_cursor(JSON dict),created_at
- InboxMessage: id,user_id,application_id(nullable),connection_id(nullable),external_id(nullable),sender,recipient,subject,body(Text),category(str primary),is_read(bool false),starred(bool false),archived(bool false),received_at,created_at. unique(user_id,connection_id,external_id).
- MailDraft: id,user_id,application_id(nullable),connection_id(nullable),recipient,subject,body(Text),attachment_ids(JSON list),status(str draft),send_key(nullable unique),error(nullable Text),sent_at(nullable),created_at,updated_at
- Notification: id,user_id,application_id(nullable),kind(str),title,body(Text),is_read(bool false),created_at
- SupportProblem: id,user_id,description(Text),context(JSON dict),status(str open),created_at
- RefreshSession (root auth): id,user_id,token_hash(unique),expires_at,revoked_at(nullable),created_at
- VerificationToken (root auth): id,user_id,purpose,token_hash(unique),expires_at,used_at(nullable),created_at

Settings exact names available:
`environment` local/test/production; `database_url`; `jwt_secret`; `jwt_issuer`; `access_token_minutes`; `refresh_token_days`; `encryption_key`; `storage_backend` local/supabase; `storage_dir`; `max_upload_bytes` 10485760; `supabase_url`, `supabase_anon_key`, `supabase_service_key`, `supabase_jwt_secret`, `supabase_storage_bucket`; `auth_mode` local/supabase; `frontend_origins` list; `oauth_redirect_urls` list; `redis_url`; `worker_backend` database/celery; `allow_external_submissions` false; `webhook_connector_url`, `webhook_connector_secret`; `connector_allowed_hosts` list; `mail_mode` demo/smtp; `mail_allowed_hosts` list; `mail_timeout_seconds` 15; `smtp_host`, `smtp_port` 465, `smtp_username`, `smtp_password`, `smtp_from`; `auth_email_mode` capture/smtp; `upload_allowed_types` list; `worker_lease_seconds` 300; `max_application_attempts` 3. Additional settings are defined in app/core/config.py.

Domain response contracts flexible, document own APIs. `matching.compute_match(job, profile, preferences)` must exist and return a dict with `score` numeric, `eligible` bool, `matched_skills`, `missing_skills`, `missing_certifications`, `reasons`, `blockers`, `score_kind='heuristic_fit'`; arguments may be ORM Profile/Preferences or plain data dicts, support both. Automation should use this function and preserve result.

Additional persisted fields: `Application.outcome` nullable interview/offer/rejected/withdrawn; `MailConnection.sync_cursor` JSON; `MailDraft.connection_id` nullable. Application outcomes preserve the confirmed submission state. Job uniqueness is `(owner_id, source, source_id)` with import-service deduplication for shared rows as well. Browser settings: `browser_connector_config` dictionary, `browser_timeout_seconds` (30), `browser_channel` chromium/chrome/msedge. `request_max_bytes` and `auth_rate_limit` bound requests. Optional settings are documented in `.env.example`; implementation remains authoritative.

Test fixtures root provides: `client` TestClient with fresh isolated SQLite StaticPool database/settings/storage per test; `db` Session same engine; `user` User; `headers` bearer credentials for user; `other_user` User; `other_headers`; `settings` Settings. Fixture users have Profile, Preferences and AutomationSettings created. Test imports app via pytest pythonpath backend. No live network in tests; use monkeypatch/httpx.MockTransport.

Documents extraction is synchronous bounded upload. Unsupported/image-only documents require user confirmation/manual profile data, not invented content. Public job import hosts fixed Greenhouse/Lever HTTPS endpoints; supplied job text import is allowed but do not fetch arbitrary URLs. Matching roles/skills are explainable heuristics.

Celery publishes wake-ups; database application records are source of truth and a database polling CLI works without Redis. Never execute submissions in request handlers. Demo connector can return only clearly marked demo confirmation. Real connector behind allow_external_submissions + configured allowlisted HTTPS URL; do not contact external employer or send real email during development. Ambiguous submission --> uncertain; never blindly retry. Bearer user identity required for all personal resources. Profile automatic mode is opt-in.
