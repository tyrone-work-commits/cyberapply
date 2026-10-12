from uuid import uuid4

import pytest

from app.cli import configure_job
from app.models import Job


def test_server_only_connector_configuration_is_validated_and_can_be_removed(db, settings, monkeypatch):
    job = Job(title="SOC Analyst", company="Test", description="Cybersecurity")
    db.add(job)
    db.commit()
    monkeypatch.setattr("httpx.Client", lambda *a, **kw: pytest.fail("Configuration must not contact an employer"))
    settings.webhook_connector_url = "https://employer.example/apply"
    settings.webhook_connector_secret = "configured-employer-test-secret-32-characters"
    settings.connector_allowed_hosts = ["employer.example"]
    assert settings.allow_external_submissions is False
    configure_job(job.id, "webhook")
    db.refresh(job)
    assert job.connector_key == "webhook"
    assert settings.allow_external_submissions is False
    configure_job(job.id, "unsupported")
    db.refresh(job)
    assert job.connector_key == "unsupported"


def test_connector_assignment_rejects_bad_configuration_and_demo_conversion(db, settings):
    job = Job(title="SOC Analyst", company="Test", description="Cybersecurity")
    demo = Job(title="SOC Analyst", company="Demo", description="Fictional", connector_key="demo", is_demo=True)
    db.add_all([job, demo])
    db.commit()
    with pytest.raises(ValueError):
        configure_job(job.id, "webhook")
    with pytest.raises(ValueError):
        configure_job(demo.id, "unsupported")
    with pytest.raises(ValueError):
        configure_job(str(uuid4()), "unsupported")
    with pytest.raises(ValueError):
        configure_job("invalid", "unsupported")
    db.refresh(job)
    db.refresh(demo)
    assert job.connector_key == "unsupported"
    assert demo.connector_key == "demo"
