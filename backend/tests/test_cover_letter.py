from types import SimpleNamespace

from app.services.cover_letter import prepare_cover_letter


def test_letter_uses_only_confirmed_skills_shared_with_the_role():
    job = SimpleNamespace(title="Security Engineer", company="Acme", required_skills=["SIEM", "Threat hunting"])
    letter = prepare_cover_letter(job, {"full_name": "Alex Doe", "skills": ["siem", "Python"]})
    assert "Security Engineer" in letter and "Acme" in letter
    assert "Alex Doe" in letter and "siem" in letter.casefold()
    assert "Threat hunting" not in letter and "Python" not in letter
    assert "years of experience" not in letter


def test_letter_does_not_invent_skills_when_profile_has_none():
    job = SimpleNamespace(title="SOC Analyst", company="Acme", required_skills=["Splunk"])
    letter = prepare_cover_letter(job, {"first_name": "Alex", "last_name": "Doe", "skills": []})
    assert "Alex Doe" in letter and "SOC Analyst" in letter
    assert "Splunk" not in letter
    assert "discuss how my background fits" in letter
