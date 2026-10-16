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

The Covenda internal version lives in [internal-workspace](internal-workspace/README.md). It uses ChatGPT identity, Sites hosting, D1 saved records/history and private R2 files, with the same per-user records exposed as agent tools. It is a focused internal pilot; the Next.js/FastAPI app described above is retained. No new Vercel/Render subscription is required for this pilot. Employer submission and live job ingestion remain unconnected. The internal README records the corrected plan, review flow, checks and limits.

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
