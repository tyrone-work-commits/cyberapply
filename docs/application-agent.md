# Application agent status

The local application agent previously paired with the hosted CyberApply Site has been removed. The pairing controls, companion script, form registry, and dispatch bridge are gone. The former `/api/agent/pair`, `/api/agent/claim`, `/api/agent/cv`, and `/api/agent/result` routes return HTTP 410 and cannot hand a selected CV to the old worker or report a new submission. Do not use previously issued pairing tokens.

Right swipe / Apply now saves an unsent application request with the selected CV reference, candidate facts, and application text. It does not open, fill, or submit an employer form. The Applications page shows the original vacancy link and the next action. Existing confirmed receipts and immutable history are preserved. Previously queued requests become **Needs action**; previously processing requests become **Check outcome** and require direct employer verification before any retry.

The separate ChatGPT workspace agent tools still exist. The original local FastAPI backend also retains generic, opt-in browser-form code for development, but it is not connected to the hosted Site. No replacement application agent has been specified or built yet. A future agent needs an explicit design, authorized employer access, clear handling for unanswered questions and uncertain outcomes, and confirmation evidence before it may mark a job **Applied**.
