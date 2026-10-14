# CyberApply

Local cybersecurity job application workspace, with a responsive frontend and FastAPI backend.

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
