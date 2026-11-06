# CyberApply job-page extension (local pilot)

Reads only the visible listing on the LinkedIn Jobs, Indeed or Glassdoor page you choose. Save creates a private tracker item; Scan uses the CV already chosen in CyberApply and opens a report. Neither action applies to the employer. It never reads passwords, form answers, messages or the entire page body, and never crawls jobs in the background.

## Build and install

1. Install the existing `internal-workspace` project dependencies using its documented workflow. From the repository root run `node extension/build.mjs`.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/dist`. Alternatively unzip `extension/cyberapply-extension.zip` and load that folder.
3. Pin CyberApply. Open a specific job listing and expand its description. Click the extension, then **Show job panel**. Review the title and use Save or Scan. Site layout changes can prevent extraction; no whole-page fallback is used.
4. Sign in to the private CyberApply site as usual. No new account system or public access is introduced.

## Private-site transfer (recommended default)

Sites may block extension requests at its outer ChatGPT authentication gate. The extension then opens the authenticated **Receive a job** screen. Review the captured description and click Save or Save and scan. Only public listing details cross this bridge; no token, CV or profile enters the job page or URL. A fallback **Copy transfer** button copies the listing JSON for the same screen. If sign-in redirects lose the screen, use **Open pending transfer** in the popup. Pending details and local recent jobs are held for this browser session only. Confirm the transfer using the intended CyberApply account.

## Optional direct connection

Copy the extension ID shown on `chrome://extensions`. In CyberApply **Settings → Browser extension**, enter that ID, choose an expiry and explicitly authorize the three scopes. Copy the one-time token into the extension popup. The token is kept in Chrome `storage.session` (trusted extension contexts only by default), never in page DOM, local storage, logs or a URL. Reconnect after Chrome restarts. Revoke it at any time in Settings. Direct requests can still be blocked by the outer private-site gate; the transfer fallback preserves that gate rather than bypassing it. Do not paste a Site bearer, worker pairing secret or password into this extension.

Permissions are `activeTab`, `scripting`, `storage`, and one host permission for the exact CyberApply origin. Job-site access is temporary and begins only when you click the extension. Tokens can save jobs, run quota-limited scans and read recent imported job metadata/remaining scans. They cannot download CVs, edit profile facts, submit applications, or access another account. API CORS is restricted to the registered extension ID. One transfer ID is idempotent across direct/transfer retries, including scan quota reservation. A second explicit Scan creates a new transfer only after reopening the panel; ordinary failed retries retain the same ID.

This is an unpacked pilot, not a Chrome Web Store publication. Automated protocol/storage checks and the app transfer UI can be tested locally; installation, Chrome permission grant, real job extraction and the hosted direct connection require user testing. No installation or persistent extension grant has been performed by the build.
