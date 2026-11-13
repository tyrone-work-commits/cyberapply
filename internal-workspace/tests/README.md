# Test scopes

Run the deterministic logic, in-memory SQLite storage, redacted feed fixtures and file-processing tests with:

```powershell
node scripts/test-offline.mjs
```

Run `npx tsc --noEmit` and `npm run build` from `internal-workspace` for type/build checks. Python runner tests have their own fixtures and requirements under `application_agent`.

The `*-http.test.mjs`, `http.test.mjs`, `job-live.test.mjs`, `live-workspace.test.mjs`, `mcp.test.mjs` and `onboarding.test.mjs` scripts are separate integration harnesses. Read each script's environment requirements before using it. They target disposable mock Sites on ports 8787/8792 by default and may mutate or delete fixture records. Some require explicit isolated-delete authorization. They must not run against the retained personal preview, a real account or production. The current Vinext mock uses a cookie-bound identity and does not emulate the older per-header multi-user test server.

Extension tests use fabricated listings and in-memory owners only. They cover token revocation/expiry/scope/origin checks, URL normalization, owner isolation, repeated transfers and atomic quota reservation. They do not install an extension or claim a real Chrome/hosted job-page connection was tested.
