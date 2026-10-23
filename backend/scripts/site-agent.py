"""Outbound-only companion for the paired CyberApply Site.

This process is deliberately inert until an operator supplies a one-time Site
pairing token, an exact reviewed employer-form registry, and --submit. It never
uses a personal browser profile or claims an application succeeded without the
form connector's confirmation.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.browser_apply import BrowserFormConnector, origin
from app.workers import ApplicationAttention, UncertainSubmission


def configured_form(job: dict, registry: dict):
    """Select only an exact employer origin and path prefix from local config."""
    target = job.get("applyUrl")
    target_origin = origin(target)
    for key, form in registry.items():
        if not isinstance(form, dict) or form.get("company") != job.get("company"):
            continue
        if target in form.get("apply_urls", []) and target_origin in form.get("origins", []) and any(
            urlsplit(target).path.startswith(prefix)
            for prefix in form.get("path_prefixes", [])
            if isinstance(prefix, str) and prefix.startswith("/")
        ):
            return key, form
    raise ApplicationAttention("This employer form has not been reviewed and configured for automatic submission")


def answers_from_candidate(candidate: dict):
    name = str(candidate.get("fullName") or "").strip()
    parts = name.split(None, 1)
    return {
        "full_name": name,
        "first_name": parts[0] if parts else "",
        "last_name": parts[1] if len(parts) > 1 else "",
        "email": candidate.get("email") or "",
        "location": candidate.get("location") or "",
        "linkedin": candidate.get("linkedInUrl") or "",
        "github": candidate.get("githubRepositoryUrl") or "",
        "portfolio": candidate.get("portfolioWebsiteUrl") or "",
    }


def run_once(client: httpx.Client, registry: dict, *, submit: bool):
    response = client.post("/api/agent/claim")
    response.raise_for_status()
    packet = response.json()
    if not packet.get("job"):
        return False
    job_data, application_data = packet["job"], packet["application"]
    claim_id, application_id = application_data["claimId"], application_data["id"]
    outcome = {"applicationId": application_id, "claimId": claim_id}
    try:
        key, form = configured_form(job_data, registry)
        if not form.get("receipt_selector"):
            raise ApplicationAttention("This employer form needs a verified receipt selector before automatic submission")
        if not submit:
            raise ApplicationAttention("Local agent is in inspection mode; no employer form was submitted")
        candidate = application_data["candidate"]
        if not candidate.get("reviewed"):
            raise ApplicationAttention("Candidate facts were not reviewed")
        cv = application_data["cv"]
        document = client.get("/api/agent/cv", params={"applicationId": application_id, "claimId": claim_id})
        document.raise_for_status()
        if len(document.content) != cv["size"] or len(document.content) > 12_000_000:
            raise ApplicationAttention("The chosen CV does not match the saved application")
        allowed_hosts = {urlsplit(item).hostname for item in form["origins"]}
        allowed_hosts.update(form.get("resource_hosts", []))
        config = SimpleNamespace(
            allow_external_submissions=True,
            browser_connector_config={key: form},
            connector_allowed_hosts=list(allowed_hosts),
            browser_timeout_seconds=30,
            browser_channel="chromium",
        )
        job = SimpleNamespace(apply_url=job_data["applyUrl"], attributes={"browser_connector_key": key})
        application = SimpleNamespace(
            id=application_id,
            idempotency_key=application_id,
            user_id="paired-site-user",
            cover_letter=application_data["coverLetter"],
            answers=answers_from_candidate(candidate),
        )
        def upload(_application):
            return {"name": cv["name"], "mimeType": cv["type"], "buffer": document.content}
        receipt = BrowserFormConnector(config, upload_provider=upload).submit(application, job)
        outcome.update(status="applied", message="Employer confirmation and receipt observed by the application agent.", receipt=receipt.confirmation_id)
    except ApplicationAttention as exc:
        outcome.update(status="needs_attention", message=str(exc)[:500])
    except UncertainSubmission as exc:
        outcome.update(status="uncertain", message=str(exc)[:500])
    except Exception:
        # A transport or browser failure after an attempted click must never
        # trigger an automatic retry of a possibly delivered application.
        outcome.update(status="uncertain", message="The agent could not verify whether the employer received this application. Check the employer before retrying.")
    result = client.post("/api/agent/result", json=outcome)
    result.raise_for_status()
    print(f"Application {application_id}: {outcome['status']}")
    return True


def main():
    parser = argparse.ArgumentParser(description="CyberApply paired local application agent")
    parser.add_argument("--site-url", default="https://cyberapply-internal.covenda-1182.chatgpt.site")
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--submit", action="store_true", help="Allow clicks on configured employer Submit controls")
    parser.add_argument("--poll", action="store_true", help="Keep checking while this computer is running")
    args = parser.parse_args()
    url = urlsplit(args.site_url)
    if url.scheme != "https" or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment:
        parser.error("Use the exact HTTPS Site origin, without credentials or a path")
    token = os.getenv("CYBERAPPLY_SITE_AGENT_TOKEN", "")
    if not token.startswith("ca1."):
        parser.error("Set CYBERAPPLY_SITE_AGENT_TOKEN privately from Settings first")
    registry = json.loads(args.registry.read_text(encoding="utf-8"))
    if not isinstance(registry, dict):
        parser.error("The employer form registry must be a JSON object")
    if not args.submit:
        parser.error("This agent cannot claim applications without --submit; review the exact employer registry first")
    with httpx.Client(base_url=args.site_url, headers={"Authorization": f"Bearer {token}"}, timeout=45, follow_redirects=False) as client:
        while True:
            try:
                worked = run_once(client, registry, submit=True)
            except httpx.HTTPError as exc:
                print(f"Site connection failed: {type(exc).__name__}", file=sys.stderr)
                worked = False
            if not args.poll:
                break
            time.sleep(5 if worked else 20)


if __name__ == "__main__":
    main()
