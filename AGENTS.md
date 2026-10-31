# CyberApply progress reporting

After each meaningful set of changes to this project, post a native Linear project status update. The user explicitly requested this workflow on 13 October 2026.

Use the existing **CyberApply — Cybersecurity Job Automation** project in the FDE team, project ID `aeb6d61b-8097-4677-aa5c-accbc104a2e8`. Summarize completed work, checks actually performed, relevant GitHub commits or pull requests, and remaining work or dependencies. Distinguish verified local behavior from untested live integrations or deployment.

Keep the existing issues and build-history document current where appropriate. The document ID is `9c236421-f368-4107-ab99-40892d61cb9e`. A document edit or issue comment does not replace the requested native project status update.

Continue the established workflow: make requested changes → perform relevant checks → commit and publish to the connected GitHub repository → update Linear issues/build history as needed → post the project update. Record reporting-only changes without rerunning unrelated application tests.

# Core application-agent behavior

Automatic diagnosis and recovery of routine employer-form problems is a core feature requested on 30 October 2026. Use the chosen original CV and saved Account Profile, try supported alternative interactions and bounded in-page repairs, and retain the repair outcome. Do not ask the user to repeat facts already saved merely because a widget failed. Technical failures must be distinguished from missing applicant facts.

Recovery must preserve authorization and duplicate-prevention boundaries: never invent personal facts, bypass a verification challenge, silently grant a new destination access, replay Continue/Submit or automatically restart a possibly delivered application. Applied requires new employer-confirmation evidence. Exhausted repairs or genuinely missing facts/consent/verification must remain an honest pause, not an infinite retry loop or false success.
