# CyberApply

Cybersecurity job application workspace. The original local version has a responsive frontend and FastAPI backend; the private Covenda pilot is linked below.

1. [Start the backend and worker](backend/README.md).
2. Start the frontend from this folder:

   ```powershell
   .\frontend\scripts\start-frontend.ps1
   ```

3. Open **http://localhost:3000**. Create an email account or choose **Explore the demo**.

The palette button lets you choose **Paper, Midnight, Ocean, Forest or Ember**, or follow your device. The full frontend workflow and checks are documented in [frontend/README.md](frontend/README.md).

Google and Apple account creation/sign-in use Supabase Auth; follow [the provider setup guide](backend/README.md#connect-google-and-apple-sign-in). The buttons show provider readiness and visible retry/error feedback. Google, Apple, phone, live mail and external submission connectors require backend provider configuration. The local setup uses captured mail and demo submissions. Nothing has been deployed publicly.

Right swipes wait five seconds for **Undo** before processing. Job cards show automatic, demo or manual employer application availability. The app can choose the best reviewed résumé per role and create a factual targeted draft for review. Applications include interview/follow-up schedules and calendar downloads.

Profile → Appearance offers account-synced themes, larger text and installation help. The production build keeps Saved job listings available offline, with choices explicitly reviewed after reconnecting. Profile → Account & security offers an authenticator, one-use recovery codes, private export and account erasure. The first live employer connection has been deferred by the user.


## Private internal delivery

The Covenda internal version lives in [internal-workspace](internal-workspace/README.md). It uses ChatGPT identity, Sites hosting, D1 saved records/history and private R2 files, with the same per-user records exposed as agent tools. It is a focused internal pilot; the Next.js/FastAPI app described above is retained. No new Vercel/Render subscription is required for this pilot. Greenhouse and Lever employer-board discovery is now available; employer submission remains unconnected. The internal README records the corrected plan, review flow, checks and limits.

### Private pilot release — 15 October 2026

Open [CyberApply · Covenda Internal Workspace](https://cyberapply-internal.covenda-1182.chatgpt.site/) and sign in with the ChatGPT account granted access. The deployed version is **1**. Access is restricted to the work owner and the named reviewer, Osioke (`osioke@gmail.com`); the reviewer's separate login has not been tested. Each person uses their own candidate records.

The internal flow is **confirm candidate facts → add a job listing → pass or prepare a draft → edit and review → inspect saved history**. Five appearance themes are saved with the workspace. A ready draft still requires manual application; no employer submission is connected.

Release evidence:

- TypeScript and production build passed; **8 domain tests, 19 local HTTP checks and 9 local MCP checks** passed. Local checks cover review gates, ownership, private files, concurrent revisions and history.
- Local browser checks confirmed candidate/draft save and exact draft text after refresh. The reviewed draft screen had no horizontal overflow at a 320-pixel viewport. No physical iPhone test was performed.
- Hosted sign-in worked. Saving Ocean appearance through the live website produced revision 1; refreshing retained it, and the connected ChatGPT tools read the same revision and activity. The live narrow viewport had equal content and viewport widths (435 pixels).
- Native Sites deployment status confirmed success and the private agent connection is installed and verified by actual remote reads. Source implementation: [2f54360](https://github.com/tyrone-work-commits/cyberapply/commit/2f543600aee8a3f14254dcf87b5d372478f86870), in [draft PR #1](https://github.com/tyrone-work-commits/cyberapply/pull/1).

PDF/DOCX parsing, live job ingestion, mail, scheduled processing and employer submissions are not connected in this hosted pilot. The original local application's broader functionality and provider setup are preserved separately. Vercel billing remains paused; no Render service was deployed for this release.


### Complete fictional demo — 16 October 2026

The default [private app](https://cyberapply-internal.covenda-1182.chatgpt.site/) opens a populated, per-user demo: Maya Okafor's fictional CV, four fictional companies/jobs, saved roles, editable drafts, an explained CV quality report and a clearly labelled preloaded simulated receipt. Personal records remain separate at `/?mode=personal`.

**CV review → Explore → prepare → edit/save → mark ready → confirm simulated send → saved receipt and exact CV/application snapshot → refresh/history.**

CV quality is calculated from six transparent text checks with points, evidence and suggestions. Editing/importing CV text invalidates the old report; running review assesses the new saved text. This is a heuristic quality review, not an ATS score or hiring prediction. TXT imports work; PDF/DOCX files still require pasted text for analysis.

Only fictional listings can be sent in demo mode. Sends create private simulated receipts, with duplicate protection and exact reviewed draft/CV snapshots. No company, email address or external service receives an application. Example setup actions are explicitly distinguished from actions performed during a demonstration. The agent tools default to the same demo records and expose CV review and simulated receipt operations. See [the internal README](internal-workspace/README.md#complete-fictional-demo--16-october-2026) for scope and checks.


Version **2** deployed successfully on 16 October 2026. TypeScript/build, 14 domain tests and 50 local HTTP/MCP checks passed. Browser checks at 320 and 1366 pixels had no horizontal overflow. On the live site, adding a fictional Education section changed the CV score from 81 to 85; a new SOC draft was edited, reviewed and sent in demo mode. After refresh, receipt `DEMO-85ADE6A0` retained the exact draft version 3 and updated CV. Connected agent reads returned the same demo revision 6 and immutable receipt snapshot. The preloaded receipt is separately labelled as an example; it is not counted as a performed send. No physical-device or real-employer acceptance is claimed.


### Sign-in and profile-first entry — 16 October 2026

The [private app's root URL](https://cyberapply-internal.covenda-1182.chatgpt.site/) now starts with **Sign in / Create account**, using the existing ChatGPT identity connection. The flow is **account access → save account profile → choose Enter demo or Open my workspace**. A returning user retains the saved profile and can edit it from the choice screen.

Profile setup stores name, optional professional headline and target role separately from candidate CV facts. It does not overwrite candidate records or the fictional demo. Direct workspace links require a saved account profile; authenticated APIs and agent tools keep their existing ownership checks. The demo is now at `/workspace?mode=demo`; personal records are at `/workspace?mode=personal`. Private Sites may present their platform access gate before the custom entry screen for signed-out visitors.

TypeScript and production build passed. Seventeen domain tests and thirteen onboarding HTTP checks passed. Local browser acceptance covered create-account entry → profile save → workspace choice → populated demo, including saved profile after refresh. Entry and profile screens had no horizontal overflow at 320/1366-pixel viewports; the workspace-choice screen was also checked at 320 pixels. Hosted verification is recorded separately in Linear. No new OAuth provider, password store or hosting subscription was added.


### Themes across account entry, setup and workspaces — 17 October 2026

The **Theme** button on sign-in/create-account and profile setup/choice offers **Paper, Midnight, Ocean, Forest and Ember**. Workspace palette controls are retained. A selected theme follows navigation and refresh on the same browser; workspace selections also retain their existing authenticated server save. An appearance-only preference cookie prevents the default palette from replacing a chosen theme between pages. No candidate data or authentication is stored in that cookie.

TypeScript passed. Local browser checks covered all five selections, reload persistence, entry/profile/demo navigation in both directions, preservation of unsaved profile text, responsive chooser/entry sizing, Escape dismissal and focus return. Final build and hosted deployment are verified as part of the release. No unrelated backend or live-integration tests were rerun for this appearance change.

## 17 October 2026 — Internal app moves from demo to Apply requests

The internal CyberApply app now opens only each visitor's own workspace. Demo entry/choice, seeded candidates and jobs, simulated sends/receipts and simulation agent tools were removed. Retired API scope is rejected; old page URLs return to the real workspace. Personal records/history and all five themes are retained.

Explore now says **Apply**, including right-swipe feedback and the visible action button. Requests save exact materials and persist in Applications, with a clear **Needs action — connection required / not submitted** state. Duplicates are prevented and subsequent edits flag changed materials. This is not yet automatic submission: Covenda has no known approved LinkedIn source/submission access, and the user asked to record that dependency in Linear (FDE-26/FDE-27). No LinkedIn session, paid provider or employer endpoint was connected.

Verified locally: TypeScript, production build, 68 automated checks (14 domain + 19 HTTP + 9 MCP + 13 onboarding + 13 live-workspace acceptance), actual right swipes at desktop/320px width, edit/refresh persistence and no horizontal overflow in the reviewed phone layouts. The Windows npm shim failed before invoking the build, so the same configured build script was run directly with Node and passed. Hosted release verification and the published source commit are recorded in Linear after publication. No live LinkedIn or employer acceptance test is claimed.


## 17 October 2026 — Real Greenhouse and Lever vacancies

The current private internal app replaces LinkedIn-specific UI, links and feed prompts with **Find live jobs** using public Greenhouse/Lever employer boards. Initial employers are Huntress, Recorded Future and Safe Security. Users can manage up to five boards, filter role/location/remote work and retain source attribution, original application links and last-checked availability. No candidate information is sent during discovery.

Search results/settings survive refresh. Refresh deduplicates vacancies and preserves choices/drafts; disappeared vacancies are marked unavailable only after a complete successful scan. Partial feed failures retain saved work. The connected agent exposes the same durable source settings/reports and discovery action. Existing CVs, history, themes and the original local application are retained.

Validation: 92 local automated checks, TypeScript and production build; actual public feeds produced 23 matching vacancies at the time checked. Phone-width browser checks covered source management, filtering to a real remote UK vacancy, a right-swipe Apply request and persistence after refresh, with no horizontal overflow. These were loopback checks, not a physical-device or employer-submission test.

Automatic employer submission is still not connected: Apply records an unsent request, and the original employer form is available for manual completion. FDE-27 tracks authorized submission access and real acceptance evidence. No paid provider or new hosting service was enabled. Final hosted release details and GitHub source are recorded in Linear.


## 17 October 2026 — Immediate swipe feedback and centered Undo

The private internal app now advances the Explore card immediately while choices save in order in the background. The controls read **Reject · Undo · Apply**. Undo restores the latest rejection or unsent Apply request, keeps edited application text and leaves the earlier saved history intact. It remains available after the final card; the five-second timer has been removed.

Deferred-network tests verify that card changes and Undo do not await saves. Operation IDs, duplicate protection, lost-response reconciliation, rollback and an explicit reload state protect saved work. TypeScript, production build and 91 automated checks passed for this change. Browser checks at 320px/1366px covered control placement, button/keyboard actions, an actual mobile right swipe, Undo, refresh persistence and no horizontal overflow. Physical-phone latency and actual employer submission were not tested. Release IDs and post-publication evidence are recorded in Linear.


## 17 October 2026 — Swipe up to save for later

Explore supports three choices: **left to Reject, right to Apply, up to Save for later**. Swiping up or tapping the bookmark immediately moves the role to Saved and shows the next unsaved open card. The bookmark also updates immediately when removing a role from Saved. Saved roles remain out of Explore after refresh and employer-feed refresh; removing their bookmark makes open roles eligible again. The centered Undo restores the latest save as well as the existing Reject/Apply choices. Arrow Up provides the keyboard equivalent.

Bookmarks now use the same ordered background queue and operation receipts as swipes. Slow responses do not hold the interface; duplicate clicks, lost responses, rollback and explicit recovery use the existing safeguards. Save/Undo preserves application requests, edited drafts and job disposition. Upward and horizontal card gestures are handled by the app; downward gestures and the area around the card allow page scrolling. Short drags and ambiguous diagonals make no decision.

Validation: TypeScript and production build passed, along with **106 automated checks** (22 domain, 10 deferred-network queue, 4 direction thresholds, 16 swipe/bookmark HTTP, 9 MCP, 13 onboarding, 13 live-workspace, 19 HTTP/storage). Browser checks at 320px/1366px covered an actual upward drag, bookmark advancement, an enabled next bookmark, Arrow Up, Undo, Saved membership and persistence after refresh. No horizontal overflow was observed. These are desktop-browser viewport checks, not a physical-iPhone performance test. Actual employer submission remains unconnected. Publication evidence is recorded in Linear.


## 17 October 2026 — Live-search countdown

The live-search button shows **Search again in N seconds** during the one-minute wait and becomes available automatically at zero. Normal waiting is displayed beside the search controls rather than as a Something needs your attention warning. Form submission by Enter is guarded too. Existing results stay available while waiting; expiry enables the button without launching another search.

Workspace responses return the server's remaining wait in milliseconds. Reload resumes the remaining interval rather than starting another minute; a structured 429 response and Retry-After header allow the interface to recover if the server still requires waiting. The countdown uses relative server timing rather than assuming the visitor's clock matches the server. Saved data, revision conflict checks and the server limit remain intact.

Validation: TypeScript and production build passed; **94 automated checks** passed (6 countdown boundaries/clock offsets, 12 source normalization, 22 domain, 10 deferred queue, 16 actual-feed HTTP, 9 MCP, 19 HTTP/storage). Compiled loopback tests checked structured wait responses, matching Retry-After, reload timing, owner isolation and unchanged saved state after a blocked search. Real public Greenhouse/Lever feeds were read; no candidate information was sent. Browser checks covered the decreasing countdown, disabled button, Enter guard, persistence after reload, automatic re-enable with the note removed at zero, and 320px/1366px layouts without horizontal overflow. Physical-phone testing was not performed. Release details are recorded in Linear after publication.


## 17 October 2026 — More employer sources and broad cybersecurity searches

Added five verified employer feeds: GuidePoint Security, KnowBe4, Abnormal AI, Wiz and Chainguard. The starting list now contains eight employers, with support for up to ten Greenhouse/Lever boards. Existing saved selections are preserved; Add recommended sources expands them without duplicates or resetting keyword/location/remote filters. Source choices persist when the next search completes. The agent uses the same source limits and saved report.

Typing cybersecurity (also cyber security, cyber-security, cybersecurity jobs, information security or infosec) now selects related security roles, such as SOC Analyst, Security Engineer, incident response and GRC roles. Specific role phrases, location and Remote only remain filters. Real source department names are retained so a relevant department can explain a generic title consistently after refresh. Empty-result guidance explains that location and remote filters can still exclude vacancies.

Fetching is limited to three boards at once and retains requested source order. Existing fixed hosts, deadlines, response/pagination bounds, partial-failure behavior, owner isolation, one-minute countdown, 24-new-role import limit and saved-choice/draft preservation remain. No new paid provider or external submission was enabled.

Validation: TypeScript and production build passed; **101 checks** passed (16 source/matching/concurrency, 22 domain, 6 cooldown, 10 deferred queue, 19 real-feed HTTP, 9 MCP, 19 HTTP/storage). All eight live feeds returned matches for cybersecurity: 517 published records and 117 matching roles at the time checked; the first isolated import added 24 roles, including all five added employers. Counts change over time. Browser checks at 320px/1366px verified the existing three-board selection expanding to eight, broad keyword results, live source reports, persistence after reload, all eight source names and no horizontal overflow. These are desktop-browser checks, not a physical-phone test. Publication evidence is recorded in Linear.
