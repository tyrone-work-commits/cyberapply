# CyberApply progress reporting

After each meaningful set of changes to this project, post a native Linear project status update. The user explicitly requested this workflow on 13 October 2026.

Use the existing **CyberApply — Cybersecurity Job Automation** project in the FDE team, project ID `aeb6d61b-8097-4677-aa5c-accbc104a2e8`. Summarize completed work, checks actually performed, relevant GitHub commits or pull requests, and remaining work or dependencies. Distinguish verified local behavior from untested live integrations or deployment.

Keep the existing issues and build-history document current where appropriate. The document ID is `9c236421-f368-4107-ab99-40892d61cb9e`. A document edit or issue comment does not replace the requested native project status update.

Continue the established workflow: make requested changes → perform relevant checks → commit and publish to the connected GitHub repository → update Linear issues/build history as needed → post the project update. Record reporting-only changes without rerunning unrelated application tests.

# Core application-agent behavior

Automatic diagnosis and recovery of routine employer-form problems is a core feature requested on 30 October 2026. Use the chosen original CV and saved Account Profile, try supported alternative interactions and bounded in-page repairs, and retain the repair outcome. Do not ask the user to repeat facts already saved merely because a widget failed. Technical failures must be distinguished from missing applicant facts.

Recovery must preserve authorization and duplicate-prevention boundaries: never invent personal facts, bypass a verification challenge, silently grant a new destination access, replay Continue/Submit or automatically restart a possibly delivered application. Applied requires new employer-confirmation evidence. Exhausted repairs or genuinely missing facts/consent/verification must remain an honest pause, not an infinite retry loop or false success.

# Upgrade-plan rules — 4 November 2026

Apply the Sorce + Jobscan PDF to the current internal `internal-workspace/` implementation, not the retired `frontend/` and `backend/` prototype. Preserve the reporting and application-agent boundaries above. Never restore public/demo accounts, Supabase or theme switching as a side effect of an outdated path in that plan.

## Protected sign-in area

Do not edit, rename, move, restyle or delete `internal-workspace/app/page.tsx`, `app/entry-screen.tsx`, `app/chatgpt-auth.ts`, `app/layout.tsx`, existing sign-in/logout routes, identity verification, access policy, auth secrets, or shared styles used by the welcome/sign-in screen. Read/import existing helpers unchanged. Post-sign-in tools and onboarding may have their own components and scoped styles. The retired auth files listed in Prompt 0 are protected historical code and must not be recreated. If a requested change requires altering authentication, stop and explain that concrete conflict. Check the final diff for protected-file changes.

## Implementation and checks

- Work through the upgrade prompts in dependency order, with meaningful checks at each stage. Track adaptations and incomplete integrations honestly in `docs/upgrade-plan-2026-11.md`.
- Keep the current Sites/Vinext/React/TypeScript, owner-scoped D1 and private R2 architecture. Use current authenticated server helpers, strict validation, bounded inputs and per-owner quotas. Add D1 migrations for new tables. Avoid introducing another account or hosting system.
- Centralize AI calls in a server-only service; default to deterministic basic suggestions. Never expose keys, log CV contents, enable paid providers, send mail, subscribe to paid services or take payment as part of scaffolding.
- Never invent employers, job titles, dates, degrees, certifications, achievements, salaries or experience. Label generated drafts, retain original files and require a user action before accepting a suggestion. Missing skills are suggestions to confirm, not established facts.
- Keep cybersecurity as the discovery default; standalone career tools support any job description. Preserve real application statuses and duplicate protection. A tracker stage or user-reported external application is not employer-confirmation evidence.
- Use fictional samples only in explicit sample reports and isolated tests; do not mix them into live jobs, CVs, applications or account data.
- Keep optional commercial scaffolding disabled in the internal workspace. Do not send notifications externally or activate device recording/geolocation without the appropriate user action/permission.
- Validate new pure logic and owner isolation; run TypeScript and the production build before advancing dependent prompts. Preserve existing sign-in assertions and app colours. Check mobile at 375px, tablet and desktop for UI changes.
