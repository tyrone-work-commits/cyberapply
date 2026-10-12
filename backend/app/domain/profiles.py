"""Candidate facts and cybersecurity job preferences, supplied or reviewed by users."""

from __future__ import annotations

import ipaddress
import re
from datetime import date
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends
from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user
from app.core.time import utcnow
from app.models import Preferences, Profile, User

router = APIRouter(tags=["Profiles and preferences"])
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]
Country = Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Z]{2}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


def safe_profile_link(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").casefold().rstrip(".")
        port = parsed.port
    except ValueError as exc:
        raise ValueError("A valid HTTPS link is required") from exc
    if parsed.scheme != "https" or not host or parsed.username or parsed.password or port not in (None, 443):
        raise ValueError("A public HTTPS link without credentials is required")
    if any(c.isspace() or ord(c) < 32 for c in value) or "\\" in value:
        raise ValueError("Invalid link characters")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")) or "." not in host:
        raise ValueError("A public HTTPS link is required")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if not address.is_global:
            raise ValueError("Private addresses are not allowed")
    return value


class ExperienceEntry(StrictModel):
    title: Label
    company: Label
    start_date: date | None = None
    end_date: date | None = None
    current: bool = False
    description: str = Field(default="", max_length=5000)

    @model_validator(mode="after")
    def chronological(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("Experience end date must not precede start date")
        if self.current and self.end_date:
            raise ValueError("Current employment must not have an end date")
        return self


class EducationEntry(StrictModel):
    institution: Label
    qualification: Label
    field: str = Field(default="", max_length=150)
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def chronological(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("Education end date must not precede start date")
        return self


class ProfileData(StrictModel):
    full_name: str = Field(default="", max_length=200)
    first_name: str = Field(default="", max_length=100)
    last_name: str = Field(default="", max_length=100)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    location: str = Field(default="", max_length=200)
    country: Country | None = None
    headline: str = Field(default="", max_length=250)
    summary: str = Field(default="", max_length=10000)
    skills: list[Label] = Field(default_factory=list, max_length=150)
    certifications: list[Label] = Field(default_factory=list, max_length=100)
    experience: list[ExperienceEntry] = Field(default_factory=list, max_length=50)
    education: list[EducationEntry] = Field(default_factory=list, max_length=30)
    linkedin_url: str | None = Field(default=None, max_length=2048)
    website: str | None = Field(default=None, max_length=2048)
    portfolio_url: str | None = Field(default=None, max_length=2048)
    links: dict[str, str] = Field(default_factory=dict)
    work_authorization: dict[str, bool | None] = Field(default_factory=dict)
    citizenships: list[Country] = Field(default_factory=list, max_length=10)
    sponsorship_required: bool | None = None
    security_clearance: Literal["none", "public_trust", "confidential", "secret", "top_secret", "ts_sci"] | None = None
    years_experience: float | None = Field(default=None, ge=0, le=80)
    salary_expectation: float | None = Field(default=None, ge=0, le=100000000)
    available_start_date: date | None = None

    @field_validator("linkedin_url", "website", "portfolio_url")
    @classmethod
    def public_links(cls, value):
        return safe_profile_link(value)

    @field_validator("links")
    @classmethod
    def bounded_links(cls, value):
        if len(value) > 20 or any(len(key) > 80 or not key.strip() for key in value):
            raise ValueError("Up to 20 named links are allowed")
        if any(len(link) > 2048 for link in value.values()):
            raise ValueError("Links must be at most 2048 characters")
        return {key.strip(): safe_profile_link(link) for key, link in value.items()}

    @field_validator("work_authorization")
    @classmethod
    def explicit_authorizations(cls, value):
        if len(value) > 30 or any(not re.fullmatch(r"[A-Za-z]{2}", key) for key in value):
            raise ValueError("Work authorization keys must be two-letter country codes; up to 30 allowed")
        return {key.upper(): item for key, item in value.items()}

    @field_validator("skills", "certifications")
    @classmethod
    def unique_labels(cls, value):
        return list(dict.fromkeys(value))

    @model_validator(mode="after")
    def supplied_name(self):
        if not self.full_name and (self.first_name or self.last_name):
            self.full_name = " ".join(part.strip() for part in (self.first_name, self.last_name) if part.strip())
        return self


class ProfileUpdate(StrictModel):
    data: ProfileData
    confirmed: bool = False


class PreferencesData(StrictModel):
    roles: list[Label] = Field(default_factory=list, max_length=40)
    locations: list[Label] = Field(default_factory=list, max_length=40)
    countries: list[Country] = Field(default_factory=list, max_length=30)
    work_modes: list[Literal["remote", "hybrid", "onsite"]] = Field(default_factory=list, max_length=3)
    remote_only: bool = False
    employment_types: list[Literal["full_time", "part_time", "contract", "internship", "temporary", "unspecified"]] = Field(default_factory=list, max_length=6)
    levels: list[Literal["intern", "entry", "mid", "senior", "lead", "manager", "director", "executive", "unspecified"]] = Field(default_factory=list, max_length=9)
    min_salary: float | None = Field(default=None, ge=0, le=100000000)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    keywords: list[Label] = Field(default_factory=list, max_length=40)
    exclude_keywords: list[Label] = Field(default_factory=list, max_length=40)
    excluded_companies: list[Label] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def consistent_modes(self):
        if self.remote_only and any(mode != "remote" for mode in self.work_modes):
            raise ValueError("remote_only conflicts with hybrid or onsite work modes")
        if self.remote_only:
            self.work_modes = ["remote"]
        return self


def profile_response(profile: Profile) -> dict:
    return {"data": profile.data, "confirmed": profile.confirmed, "updated_at": profile.updated_at}


@router.get("/profiles/me")
def get_profile(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = db.get(Profile, user.id)
    if profile is None:
        profile = Profile(user_id=user.id, data={}, confirmed=False, updated_at=utcnow())
        db.add(profile)
        db.commit()
    return profile_response(profile)


@router.put("/profiles/me")
def update_profile(payload: ProfileUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = db.get(Profile, user.id)
    if profile is None:
        profile = Profile(user_id=user.id)
        db.add(profile)
    profile.data = payload.data.model_dump(mode="json")
    profile.confirmed = payload.confirmed
    profile.updated_at = utcnow()
    db.commit()
    return profile_response(profile)


@router.get("/preferences/me")
def get_preferences(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    preferences = db.get(Preferences, user.id)
    if preferences is None:
        preferences = Preferences(user_id=user.id, data=PreferencesData().model_dump(), updated_at=utcnow())
        db.add(preferences)
        db.commit()
    return {"data": preferences.data, "updated_at": preferences.updated_at}


@router.put("/preferences/me")
def update_preferences(payload: PreferencesData, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.domain.applications import automation_settings
    # Share the submission reservation lock: a committed preference change is
    # observed before the worker records that submission has begun.
    automation_settings(db, user.id, lock=True)
    preferences = db.get(Preferences, user.id)
    if preferences is None:
        preferences = Preferences(user_id=user.id)
        db.add(preferences)
    preferences.data = payload.model_dump(mode="json")
    preferences.updated_at = utcnow()
    db.commit()
    return {"data": preferences.data, "updated_at": preferences.updated_at}
