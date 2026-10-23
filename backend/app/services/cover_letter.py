"""Create a conservative, job-specific letter from reviewed application facts.

The template intentionally makes no claims about experience, qualifications or
outcomes that the candidate did not confirm. An employer form can require the
candidate to edit or approve it before submission.
"""
from __future__ import annotations

import re


def _plain(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()[:limit]


def prepare_cover_letter(job, profile_data: dict) -> str:
    """Use only the listing identity and confirmed profile skills as source facts."""
    title = _plain(job.title, 180) or "advertised role"
    company = _plain(job.company, 150) or "your team"
    name = _plain(profile_data.get("full_name"), 150)
    if not name:
        name = " ".join(
            part for part in (
                _plain(profile_data.get("first_name"), 75),
                _plain(profile_data.get("last_name"), 75),
            ) if part
        )

    declared = profile_data.get("skills")
    declared = declared if isinstance(declared, list) else []
    confirmed = {
        skill.casefold(): skill for raw in declared
        if (skill := _plain(raw, 100))
    }
    relevant = []
    for raw in job.required_skills or []:
        skill = _plain(raw, 100)
        if skill and skill.casefold() in confirmed and confirmed[skill.casefold()] not in relevant:
            relevant.append(confirmed[skill.casefold()])
        if len(relevant) == 3:
            break

    detail = (
        "My reviewed profile lists " + ", ".join(relevant) + ", which are relevant to this role."
        if relevant else
        "I would welcome the chance to discuss how my background fits the role."
    )
    return (
        f"Dear {company} hiring team,\n\n"
        f"I am applying for the {title} position at {company}. {detail}\n\n"
        "Thank you for considering my application. I would welcome an opportunity to discuss the position.\n\n"
        f"Kind regards,\n{name or 'Applicant'}"
    )
