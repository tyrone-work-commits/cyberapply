"""Owner-scoped job imports, discovery, decisions, company follows and fit reports."""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Query
from pydantic import Field, field_validator, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import fail
from app.core.security import get_current_user
from app.core.time import utcnow
from app.domain.job_sources import SourceError, SourceImport, fetch_public_jobs, validate_public_url
from app.domain.matching import compute_match, is_cybersecurity_job
from app.domain.profiles import Country, Label, StrictModel
from app.models import CompanyFollow, Job, Preferences, Profile, SavedJob, User

router = APIRouter(tags=["Jobs and matching"])


class EligibilityRequirements(StrictModel):
    work_authorization_country: Country | None = None
    citizenship_country: Country | None = None
    security_clearance: Literal["none", "public_trust", "confidential", "secret", "top_secret", "ts_sci"] | None = None
    minimum_years_experience: float | None = Field(default=None, ge=0, le=80)
    sponsorship_available: bool | None = None


class JobAttributes(StrictModel):
    country: Country | None = None
    workplace_type: Literal["remote", "hybrid", "onsite", "unspecified"] = "unspecified"
    mandatory_eligibility: EligibilityRequirements = Field(default_factory=EligibilityRequirements)
    required_fields: list[Label] = Field(default_factory=lambda: ["full_name", "email"], max_length=100)
    salary_interval: Literal["year", "month", "week", "hour", "unspecified"] = "year"


class JobInput(StrictModel):
    title: str = Field(min_length=1, max_length=300)
    company: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=100000)
    location: str = Field(default="", max_length=200)
    remote: bool = False
    employment_type: Literal["full_time", "part_time", "contract", "internship", "temporary", "unspecified"] = "unspecified"
    level: Literal["intern", "entry", "mid", "senior", "lead", "manager", "director", "executive", "unspecified"] = "unspecified"
    salary_min: float | None = Field(default=None, ge=0, le=100000000)
    salary_max: float | None = Field(default=None, ge=0, le=100000000)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    required_skills: list[Label] = Field(default_factory=list, max_length=150)
    required_certifications: list[Label] = Field(default_factory=list, max_length=100)
    attributes: JobAttributes = Field(default_factory=JobAttributes)
    source_url: str = Field(default="", max_length=2048)
    apply_url: str = Field(default="", max_length=2048)
    active: bool = True
    expires_at: datetime | None = None

    @field_validator("source_url", "apply_url")
    @classmethod
    def safe_job_urls(cls, value):
        return validate_public_url(value, allow_empty=True)

    @field_validator("title", "company", "description")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Job title, company and description cannot be blank")
        return value.strip()

    @field_validator("expires_at")
    @classmethod
    def utc_expiry(cls, value):
        if value and value.tzinfo is not None:
            from datetime import timezone
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    @model_validator(mode="after")
    def coherent(self):
        if self.salary_min is not None and self.salary_max is not None and self.salary_min > self.salary_max:
            raise ValueError("salary_min must not exceed salary_max")
        if self.remote and self.attributes.workplace_type in ("onsite", "hybrid"):
            raise ValueError("remote conflicts with the supplied workplace_type")
        if self.remote:
            self.attributes.workplace_type = "remote"
        elif self.attributes.workplace_type == "remote":
            self.remote = True
        return self


class DecisionInput(StrictModel):
    decision: Literal["saved", "passed"]


class FollowInput(StrictModel):
    company: str = Field(min_length=1, max_length=200)

    @field_validator("company")
    @classmethod
    def meaningful_company(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Company cannot be blank")
        return value


def accessible_jobs(user_id: str):
    return or_(Job.owner_id.is_(None), Job.owner_id == user_id)


def owned_job(db: Session, job_id: str, user_id: str, *, writable: bool = False) -> Job:
    statement = select(Job).where(Job.id == job_id, Job.owner_id == user_id if writable else accessible_jobs(user_id))
    job = db.scalar(statement)
    if job is None:
        fail(404, "job_not_found", "Job was not found.")
    return job


def job_response(job: Job, *, match: dict | None = None, decision: str | None = None) -> dict:
    fields = (
        "id", "source", "source_id", "title", "company", "description", "location", "remote",
        "employment_type", "level", "salary_min", "salary_max", "currency", "required_skills",
        "required_certifications", "attributes", "source_url", "apply_url", "connector_key", "is_demo",
        "active", "created_at", "updated_at", "expires_at",
    )
    result = {field: getattr(job, field) for field in fields}
    result["cybersecurity"] = is_cybersecurity_job(job.title, job.description)
    result["decision"] = decision
    if match is not None:
        result["match"] = match
    return result


def _match_for(db: Session, job: Job, user_id: str) -> dict:
    return compute_match(job, db.get(Profile, user_id), db.get(Preferences, user_id))


def _active_conditions():
    return (Job.active.is_(True), or_(Job.expires_at.is_(None), Job.expires_at > utcnow()))


@router.get("/jobs")
def list_jobs(
    q: str = Query(default="", max_length=200),
    location: str = Query(default="", max_length=200),
    remote: bool | None = None,
    employment_type: str | None = Query(default=None, max_length=50),
    level: str | None = Query(default=None, max_length=50),
    source: str | None = Query(default=None, max_length=50),
    include_inactive: bool = False,
    cybersecurity_only: bool = True,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100000),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = [accessible_jobs(user.id)]
    if not include_inactive:
        conditions.extend(_active_conditions())
    if q.strip():
        conditions.append(or_(*[func.lower(column).contains(q.strip().casefold(), autoescape=True) for column in (Job.title, Job.company, Job.description)]))
    if location.strip():
        conditions.append(func.lower(Job.location).contains(location.strip().casefold(), autoescape=True))
    if remote is not None:
        conditions.append(Job.remote == remote)
    for value, column in ((employment_type, Job.employment_type), (level, Job.level), (source, Job.source)):
        if value:
            conditions.append(column == value)
    if cybersecurity_only:
        terms = ("cybersecurity", "cyber security", "information security", "application security", "cloud security", "network security", "security engineer", "security analyst", "security architect", "security consultant", "soc analyst", "soc engineer", "penetration test", "threat hunting", "threat intelligence", "incident response", "devsecops", "ciso", "identity and access management", "vulnerability management", "governance risk and compliance", "grc")
        conditions.append(or_(*[func.lower(column).contains(term, autoescape=True) for column in (Job.title, Job.description) for term in terms]))
    statement = select(Job).where(*conditions)
    total = db.scalar(select(func.count()).select_from(statement.subquery()))
    jobs = db.scalars(statement.order_by(Job.created_at.desc(), Job.id).offset(offset).limit(limit)).all()
    decisions = dict(db.execute(select(SavedJob.job_id, SavedJob.decision).where(SavedJob.user_id == user.id, SavedJob.job_id.in_([job.id for job in jobs]))).all()) if jobs else {}
    profile, preferences = db.get(Profile, user.id), db.get(Preferences, user.id)
    return {"items": [job_response(job, match=compute_match(job, profile, preferences), decision=decisions.get(job.id)) for job in jobs], "total": total, "limit": limit, "offset": offset}


@router.post("/jobs", status_code=201)
@router.post("/jobs/import", status_code=201)
def import_job(payload: JobInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    values = payload.model_dump(mode="json")
    values["expires_at"] = payload.expires_at
    job = Job(id=str(uuid4()), owner_id=user.id, source="manual", source_id=str(uuid4()), connector_key="unsupported", is_demo=False, **values)
    db.add(job)
    db.commit()
    return job_response(job, match=_match_for(db, job, user.id))


@router.post("/jobs/import/source")
def import_source(payload: SourceImport, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        values, metadata = fetch_public_jobs(payload)
    except SourceError as exc:
        fail(502, exc.code, exc.message)
    imported: list[Job] = []
    created = 0
    for data in values:
        upstream_id = data["source_id"]
        composite_id = f"{payload.region}:{payload.board_token}:{upstream_id}"
        data["source_id"] = composite_id if len(composite_id) <= 200 else hashlib.sha256(composite_id.encode()).hexdigest()
        data["attributes"] = {**data["attributes"], "upstream_id": upstream_id}
        data["location"] = data["location"][:200]
        job = db.scalar(select(Job).where(Job.owner_id == user.id, Job.source == payload.provider, Job.source_id == data["source_id"]))
        if job is None:
            job = Job(id=str(uuid4()), owner_id=user.id, **data)
            db.add(job)
            created += 1
        else:
            for key, value in data.items():
                setattr(job, key, value)
            job.updated_at = utcnow()
        imported.append(job)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        fail(409, "source_import_conflict", "A concurrent import updated this board. Retry the import.")
    return {"items": [job_response(job) for job in imported], "created": created, "updated": len(imported) - created, "source": metadata, "submission_supported": False}


@router.get("/jobs/saved")
def saved_jobs(
    decision: Literal["saved", "passed"] = "saved",
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100000),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    statement = select(Job, SavedJob).join(SavedJob, Job.id == SavedJob.job_id).where(SavedJob.user_id == user.id, SavedJob.decision == decision, accessible_jobs(user.id))
    total = db.scalar(select(func.count()).select_from(statement.subquery()))
    rows = db.execute(statement.order_by(SavedJob.created_at.desc(), SavedJob.id).offset(offset).limit(limit)).all()
    return {"items": [{"id": saved.id, "decision": saved.decision, "created_at": saved.created_at, "job": job_response(job, decision=saved.decision)} for job, saved in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    job = owned_job(db, job_id, user.id)
    decision = db.scalar(select(SavedJob.decision).where(SavedJob.user_id == user.id, SavedJob.job_id == job.id))
    return job_response(job, match=_match_for(db, job, user.id), decision=decision)


@router.put("/jobs/{job_id}")
def update_job(job_id: str, payload: JobInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    job = owned_job(db, job_id, user.id, writable=True)
    values = payload.model_dump(mode="json")
    values["expires_at"] = payload.expires_at
    for key, value in values.items():
        setattr(job, key, value)
    job.updated_at = utcnow()
    db.commit()
    return job_response(job, match=_match_for(db, job, user.id))


@router.delete("/jobs/{job_id}")
def deactivate_job(job_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    job = owned_job(db, job_id, user.id, writable=True)
    job.active, job.updated_at = False, utcnow()
    db.commit()
    return {"id": job.id, "active": False}


@router.get("/jobs/{job_id}/match")
def match_job(job_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _match_for(db, owned_job(db, job_id, user.id), user.id)


def _set_decision(db: Session, job_id: str, user_id: str, decision: str):
    owned_job(db, job_id, user_id)
    from app.domain.applications import automation_settings
    automation_settings(db, user_id, lock=True)
    saved = db.scalar(select(SavedJob).where(SavedJob.user_id == user_id, SavedJob.job_id == job_id))
    if saved is None:
        saved = SavedJob(user_id=user_id, job_id=job_id, decision=decision)
        db.add(saved)
    else:
        saved.decision = decision
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        automation_settings(db, user_id, lock=True)
        saved = db.scalar(select(SavedJob).where(SavedJob.user_id == user_id, SavedJob.job_id == job_id))
        if saved is None:
            fail(409, "decision_conflict", "The job decision changed concurrently. Retry the request.")
        saved.decision = decision
        db.commit()
    return {"id": saved.id, "job_id": saved.job_id, "decision": saved.decision, "created_at": saved.created_at}


@router.put("/jobs/{job_id}/decision")
def decide_job(job_id: str, payload: DecisionInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _set_decision(db, job_id, user.id, payload.decision)


@router.post("/jobs/{job_id}/save")
def save_job(job_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _set_decision(db, job_id, user.id, "saved")


@router.post("/jobs/{job_id}/pass")
def pass_job(job_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _set_decision(db, job_id, user.id, "passed")


@router.delete("/jobs/{job_id}/decision")
def remove_decision(job_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    owned_job(db, job_id, user.id)
    from app.domain.applications import automation_settings
    automation_settings(db, user.id, lock=True)
    saved = db.scalar(select(SavedJob).where(SavedJob.user_id == user.id, SavedJob.job_id == job_id))
    if saved is not None:
        db.delete(saved)
    db.commit()
    return {"job_id": job_id, "decision": None}


@router.get("/companies")
def list_companies(q: str = Query(default="", max_length=200), limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0, le=100000), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = select(Job.company, func.count(Job.id).label("open_jobs")).where(accessible_jobs(user.id), *_active_conditions())
    if q.strip():
        statement = statement.where(func.lower(Job.company).contains(q.casefold().strip(), autoescape=True))
    statement = statement.group_by(Job.company)
    total = db.scalar(select(func.count()).select_from(statement.subquery()))
    rows = db.execute(statement.order_by(Job.company).offset(offset).limit(limit)).all()
    follows = set(db.scalars(select(CompanyFollow.company).where(CompanyFollow.user_id == user.id)))
    return {"items": [{"company": company, "open_jobs": count, "following": company in follows} for company, count in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/companies/following")
def following_companies(limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0, le=100000), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = select(CompanyFollow).where(CompanyFollow.user_id == user.id)
    total = db.scalar(select(func.count()).select_from(statement.subquery()))
    follows = db.scalars(statement.order_by(CompanyFollow.company).offset(offset).limit(limit)).all()
    return {"items": [{"id": item.id, "company": item.company, "created_at": item.created_at} for item in follows], "total": total, "limit": limit, "offset": offset}


@router.post("/companies/following", status_code=201)
def follow_company(payload: FollowInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    follow = db.scalar(select(CompanyFollow).where(CompanyFollow.user_id == user.id, func.lower(CompanyFollow.company) == payload.company.casefold()))
    if follow is None:
        follow = CompanyFollow(user_id=user.id, company=payload.company)
        db.add(follow)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            fail(409, "follow_conflict", "This company was followed concurrently. Retry the request.")
    return {"id": follow.id, "company": follow.company, "created_at": follow.created_at}


@router.delete("/companies/following/{follow_id}")
def unfollow_company(follow_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    follow = db.scalar(select(CompanyFollow).where(CompanyFollow.id == follow_id, CompanyFollow.user_id == user.id))
    if follow is None:
        fail(404, "follow_not_found", "Company follow was not found.")
    db.delete(follow)
    db.commit()
    return {"deleted": True}
