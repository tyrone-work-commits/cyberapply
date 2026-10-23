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

The hosted Site now offers an owner-scoped outbound pairing bridge. In Settings, a signed-in user creates a one-time token for a local worker, shown once and stored only as a SHA-256 hash in that user's workspace. A right swipe made after pairing, with a chosen CV and reviewed candidate facts, queues that exact CV, facts and role-specific letter. An older unsent request must be queued explicitly. The worker polls the Site over HTTPS, claims one request, downloads the chosen original privately, and reports a confirmed receipt or a precise attention/uncertain outcome. Revoking the token blocks new claims. A claimed request is not retried automatically after an uncertain outcome.

The Site's lightweight Worker cannot run Playwright. The local companion in `backend/scripts/site-agent.py` must be running on a computer with the browser runtime installed. Pairing alone does not mean the worker is online. The paired worker reuses the existing supported-form `BrowserFormConnector`; it does not make arbitrary imported job URLs executable. A real employer form must be reviewed and placed in a local registry with the exact application URL, origin, path, selectors, required fields, confirmation marker and receipt selector. The sample registry in `backend/config/site-agent.registry.example.json` is fictional and cannot send a real application. No live employer registry has been configured or real submission tested, so this remains a local pilot.

To start a reviewed form pilot on this Windows computer, copy the example registry to a private local JSON file and replace the fictional entry with the exact employer configuration. In CyberApply Settings, create a pairing token and enter it privately at the PowerShell prompt. From the repository root run:

```powershell
$env:CYBERAPPLY_SITE_AGENT_TOKEN = Read-Host -MaskInput 'CyberApply pairing token'
& '.\.venv\Scripts\python.exe' backend\scripts\site-agent.py --registry backend\config\site-agent.registry.json --submit --poll
```

Keep the registry file out of Git if it contains nonpublic settings. The process only handles this account's queued jobs while it is running. `--submit` permits the configured form's Submit click; omit it and the companion refuses to claim jobs. Never set this flag against an unreviewed form. Disconnect the agent in Settings to revoke the token. Pairing tokens expire after 30 days and can be rotated.

The Site's letter generator uses the job title and company, reviewed skills that appear in the listing, and up to two relevant action lines from the CV. It avoids invented qualifications. Users can edit the saved letter; editing or replacing the CV invalidates an unsent queue item and requires review before queueing again. This deterministic draft does not use a paid LLM and may still need personal editing for tone and fit.

### First real-form assessment

On 23 October 2026, the live [True Zero Technologies Junior Cyber Security Analyst listing](https://jobs.lever.co/truezerotech/c60b816a-f54a-49e4-bf76-c18cccfbc3cc) was used for a read-only form assessment. Its [application form](https://jobs.lever.co/truezerotech/c60b816a-f54a-49e4-bf76-c18cccfbc3cc/apply) asks for salary expectations, clearance, market-trend and skills-development explanations, home-lab details, and other individual answers. These cannot be inferred responsibly from a CV. CyberApply has not configured or submitted to this employer. Before a live pilot, choose an eligible role, confirm authorized automated access to its form, supply the missing answers privately, validate exact selectors in read-only mode, and test confirmation handling without a real submission. Do not invent the missing answers or bypass a challenge.

## Verify without contacting an employer

From the repository root, run:

```powershell
& '.\.venv\Scripts\python.exe' -m pytest backend\tests\test_cover_letter.py backend\tests\test_browser_apply.py backend\tests\test_site_agent.py -q
```

The browser test intercepts every request to a fictional employer and verifies DOM interaction, captured answers and receipt handling. The worker test verifies right-swipe-style queueing through cover-letter preparation and the Applications tracker. The Site bridge HTTP test uses fictional CV and employer data on a loopback Worker to verify owner-scoped pairing, claims, private CV delivery, receipt requirement and revocation. See [backend/README.md](../backend/README.md) for local API/worker startup, optional browser runtime installation and the administrator-only `configure-job` command. External submissions remain disabled by default.
