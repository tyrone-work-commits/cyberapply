# CyberApply application agent

The local FastAPI backend contains an opt-in application agent for supported employer forms. A right swipe on a role marked **Auto-apply available** creates an application with a five-second Undo window. The worker then uses a snapshot of the reviewed résumé and confirmed profile, prepares standard answers and a role-specific cover letter, and opens the configured employer application page in an isolated Playwright browser. It uploads the captured résumé file when the form requires it, fills mapped fields, checks required inputs, clicks Submit once, and records **applied** only after the configured confirmation appears. The Applications tracker retains the status, receipt and events.

The cover letter is a local template. It mentions the role and employer and at most three confirmed skills that overlap the listing. It does not invent experience or call a paid language-model service. The candidate can edit it in a review-mode application. For automatic mode, the right swipe authorizes the captured materials after the Undo window. Changes to the résumé or profile after queueing do not silently change those captured materials.

## What the agent supports

- An administrator registers an exact HTTPS employer origin, path prefix, form selectors, submit control and confirmation marker. Only trusted job records can use that registry entry. Public job imports cannot turn arbitrary URLs into executable forms.
- The browser blocks navigation outside configured employer origins and limits resource hosts. It does not use a personal browser profile or bypass CAPTCHA.
- Missing answers, ambiguous fields, invalid form controls and CAPTCHA move the application to **needs attention** before Submit. An uncertain result after a possible click moves it to **uncertain**; the worker must reconcile a receipt rather than click Submit again.
- A confirmed employer receipt moves the application to **applied**. A queued or prepared request is never presented as sent.

The agent cannot automatically complete every employer site. Dynamic questions, sign-in requirements, anti-bot challenges and changes to a configured form require a new reviewed mapping or human intervention. A job-board listing alone is not evidence that its application form is supported. An employer API key is one possible integration route, not a requirement for this configured browser-form route. Verify that a pilot employer permits the intended access and workflow before enabling live submissions.

## Current deployment boundary

The live Covenda ChatGPT Site and this local FastAPI backend are separate workspaces. The Site saves right swipes as **unsent Apply requests** with a snapshot of the chosen uploaded CV, candidate facts and draft; it does not invoke the local browser worker. An older unsent request can be updated to use the currently chosen CV. This agent is therefore a working **local pilot**, not a live auto-apply feature on `cyberapply-internal.covenda-1182.chatgpt.site`. Connecting that Site requires a secure, identity-scoped bridge and a continuously running browser worker. No employer, browser-worker host or live form registry has been approved or configured yet. Do not describe Site requests as submitted.

## Verify without contacting an employer

From the repository root, run:

```powershell
& '.\.venv\Scripts\python.exe' -m pytest backend\tests\test_cover_letter.py backend\tests\test_browser_apply.py -q
```

The browser test intercepts every request to a fictional employer and verifies DOM interaction, captured answers and receipt handling. The worker test verifies right-swipe-style queueing through cover-letter preparation and the Applications tracker. See [backend/README.md](../backend/README.md) for local API/worker startup, optional browser runtime installation and the administrator-only `configure-job` command. External submissions remain disabled by default.
