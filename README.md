# CyberApply - Covenda internal app

CyberApply is a private, mobile-responsive workspace for Covenda users. The current app uses ChatGPT identity and Sites hosting, Cloudflare D1 for owner-scoped records/history, and private R2 storage for original CV files. A separate local browser agent handles authorized employer-form applications.

[Open CyberApply](https://cyberapply-internal.covenda-1182.chatgpt.site/)

## Current source

- `internal-workspace/`: the deployed website, server routes, job discovery, CV review, profile, applications, related Gmail inbox, activity and tutorial.
- `application_agent/`: the active Python browser runner, Windows background setup, form handling and tests.
- `docs/application-agent.md`: setup, answer policies, recovery and submission boundaries.

Explore imports real vacancies from selected Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee employer boards where public or employer-authorized feed access is available. Swiping Apply saves a request with the chosen original CV. An enabled, connected runner can process it while the computer is awake and online. Requests that need facts, consent or verification pause honestly. A submitted click without an employer receipt stays **Check outcome**; it must not be retried automatically.

## Development

See [internal workspace setup](internal-workspace/README.md) for Node installation, local preview, checks and publishing. The website has no separate password database or social-login provider; Sites supplies ChatGPT identity and the existing workspace access policy.

For the browser runner, create a Python environment and install its own requirements only:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r application_agent/requirements.txt
.venv/Scripts/python.exe -m application_agent.background setup
```

Enter the connection string privately in the setup window, never in source or chat. Existing installations should keep their environment and encrypted local setup. See the agent guide before enabling submission.

## Retired public prototype

The earlier standalone `backend/` and `frontend/` prototypes have been removed from current source. They included separate account/password flows, demo data, theme options, Docker and standalone hosting setup that the internal app does not use. The last retained version is available in [Git history](https://github.com/tyrone-work-commits/cyberapply/tree/8166905a7e51072a89b01dd34553a42bc2589542). Do not deploy it as the current application.

Ignored local files in those old directories were not erased: they may contain private data. This cleanup does not delete cloud accounts, CV files, saved applications, account profiles, encrypted agent credentials or the shared Python environment. Retired API tombstones, history migrations and duplicate-protection logic remain intentionally.

## Progress

Meaningful changes are committed to GitHub and reported in the **CyberApply - Cybersecurity Job Automation** Linear project. Report verified local checks separately from live employer behavior. No new paid hosting, model service or publishing destination is authorized by this repository.


## Career tools upgrade

The Sorce + Jobscan upgrade adds private CV scans/history, evidence-preserving optimization, résumé and cover-letter builders, richer discovery, application settings/Actions, tracking and interview calendars, LinkedIn-content review, practice interviews, optional profile details, in-app notifications, Help/export, learning guides and a job-page extension. See [the implementation and verification ledger](docs/upgrade-plan-2026-11.md) for the complete feature list, adaptations and live-testing limits. Optional commerce, paid providers and external notifications remain inactive. The [Chrome extension](extension/README.md) requires explicit local installation and uses an authenticated transfer when private hosting blocks direct requests.
