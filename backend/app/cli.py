import argparse
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import SessionLocal, migrate_db
from app.models import Job

DEMO_JOBS = [
    ("SOC Analyst", "Example Security Operations", ["siem", "splunk", "incident response"], ["comptia security+"], "entry"),
    ("Cloud Security Engineer", "Example Cloud", ["aws", "cloud security", "terraform", "python"], [], "mid"),
    ("Application Security Engineer", "Example Software", ["application security", "owasp", "secure coding"], [], "mid"),
    ("GRC Consultant", "Example Advisory", ["nist", "iso 27001", "risk management"], ["cisa"], "mid"),
    ("Incident Response Lead", "Example Response", ["incident response", "digital forensics", "threat hunting"], ["gcih"], "senior"),
    ("Security Architect", "Example Architecture", ["cloud security", "zero trust", "network security"], ["cissp"], "senior"),
]


def seed_demo() -> int:
    if get_settings().environment == "production":
        raise RuntimeError("Fictional demo jobs are available only in local and test environments")
    migrate_db()
    count = 0
    with SessionLocal() as db:
        for index, (title, company, skills, certifications, level) in enumerate(DEMO_JOBS):
            identifier = "cyberapply-demo-" + str(index)
            if db.scalar(select(Job).where(Job.source == "demo", Job.source_id == identifier, Job.owner_id.is_(None))):
                continue
            db.add(Job(id=str(uuid5(NAMESPACE_URL, identifier)), source="demo", source_id=identifier,
                       title=title, company=company, description="Fictional local test listing. No employer receives applications.\nSkills: " + ", ".join(skills),
                       location="Remote", remote=True, level=level, employment_type="full_time",
                       required_skills=skills, required_certifications=certifications,
                       attributes={"workplace_type": "remote", "required_fields": ["full_name", "email"], "demo": True},
                       connector_key="demo", is_demo=True))
            count += 1
        db.commit()
    return count


def configure_job(job_id: str, connector: str, browser_key: str | None = None) -> None:
    """Server-side administration only; validates configuration without submission."""
    try:
        job_id = str(UUID(job_id))
    except (ValueError, TypeError) as exc:
        raise ValueError("Job ID must be a UUID") from exc
    if connector not in {"unsupported", "webhook", "browser_form"}:
        raise ValueError("Unsupported connector")
    if browser_key and connector != "browser_form":
        raise ValueError("Browser key is only accepted for browser_form")
    migrate_db()
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if job is None:
            raise ValueError("Job not found")
        if job.is_demo:
            raise ValueError("Fictional demo jobs cannot use external connectors")
        attributes = dict(job.attributes or {})
        attributes.pop("browser_connector_key", None)
        staged = get_settings().model_copy(update={"allow_external_submissions": True})
        from app.workers import ConfirmedFailure, SignedWebhookConnector

        try:
            if connector == "webhook":
                SignedWebhookConnector(staged)
            elif connector == "browser_form":
                if not browser_key:
                    raise ValueError("browser_form requires --browser-key")
                from app.services.browser_apply import BrowserFormConnector
                attributes["browser_connector_key"] = browser_key
                BrowserFormConnector(staged)._form(SimpleNamespace(attributes=attributes, apply_url=job.apply_url))
        except ConfirmedFailure as exc:
            raise ValueError(str(exc)) from exc
        job.attributes = attributes
        job.connector_key = connector
        db.commit()


def main():
    parser = argparse.ArgumentParser(description="CyberApply local maintenance")
    parser.add_argument("command", choices=["init-db", "seed-demo", "export-openapi", "configure-job"])
    parser.add_argument("--output", default="openapi.json")
    parser.add_argument("--job-id")
    parser.add_argument("--connector", choices=["unsupported", "webhook", "browser_form"])
    parser.add_argument("--browser-key")
    args = parser.parse_args()
    if args.command == "init-db":
        migrate_db()
        print("Database migrations applied")
    elif args.command == "seed-demo":
        print(f"Created {seed_demo()} fictional demo jobs; no user accounts or external applications created")
    elif args.command == "configure-job":
        if not args.job_id or not args.connector:
            parser.error("configure-job requires --job-id and --connector")
        try:
            configure_job(args.job_id, args.connector, args.browser_key)
        except ValueError as exc:
            parser.error(str(exc))
        print("Trusted job connector configured; no employer request or submission performed")
    else:
        from app.main import app
        Path(args.output).write_text(json.dumps(app.openapi(), indent=2), encoding="utf-8")
        print("Exported OpenAPI contract")


if __name__ == "__main__":
    main()
