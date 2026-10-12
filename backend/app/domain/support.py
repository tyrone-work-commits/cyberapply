"""Local help content and persisted, private problem reports."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import fail
from app.core.security import get_current_user
from app.models import Application, SupportProblem, User

router = APIRouter(prefix="/support", tags=["support"])

FAQ = (
    {"id": "review-mode", "category": "applications", "question": "What happens before an application is submitted?", "answer": "Review mode prepares an application for your approval. Automatic mode is opt-in and uses your saved preferences. Missing answers or unsupported integrations move the application to Needs attention."},
    {"id": "demo-confirmation", "category": "applications", "question": "Does a demo application reach an employer?", "answer": "No. Demo confirmations are explicitly marked as simulated. Real employer submissions need an enabled and configured connector."},
    {"id": "uncertain-delivery", "category": "applications", "question": "Why does an application show an uncertain result?", "answer": "The connector could not prove whether submission succeeded. Check the employer portal before retrying; the system does not blindly resend an uncertain application."},
    {"id": "resume-review", "category": "documents", "question": "Why should I confirm my extracted résumé information?", "answer": "Document extraction can miss details. Confirm your actual experience, skills, certifications, and contact details before using the profile to prepare applications."},
    {"id": "match-score", "category": "matching", "question": "What does the match score mean?", "answer": "It is an explainable heuristic based on your profile, preferences, and the job requirements. It is not a hiring prediction or a guarantee of an interview."},
    {"id": "mail-demo", "category": "inbox", "question": "What does captured mean in the email outbox?", "answer": "The email was saved locally for inspection. Demo mode does not send it to anyone, and the sent timestamp remains empty."},
    {"id": "connect-mail", "category": "inbox", "question": "Can I connect a mailbox?", "answer": "Supported mail providers use fixed TLS endpoints. Real mail access must be enabled by the server administrator and may require an app password or provider-specific setup. Removing a connection immediately removes its stored credentials."},
    {"id": "local-running", "category": "automation", "question": "Will background tasks continue when my computer is off?", "answer": "No. During local development, the backend and worker must remain running. A later hosted deployment can run tasks independently of your computer."},
    {"id": "stop-automation", "category": "automation", "question": "How can I stop automatic applications?", "answer": "Pause automation or switch to review mode. A submission already in progress may finish; inspect its final status before starting another."},
    {"id": "problem-reports", "category": "support", "question": "Where do problem reports go during local development?", "answer": "They are saved in your local backend for review. Submitting a report does not contact a support agent or send an email."},
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProblemContext(StrictModel):
    page: str | None = Field(default=None, max_length=200)
    application_id: str | None = Field(default=None, max_length=36)
    error_code: str | None = Field(default=None, max_length=100)
    client_version: str | None = Field(default=None, max_length=80)


class ProblemCreate(StrictModel):
    description: str = Field(min_length=10, max_length=5000)
    context: ProblemContext = Field(default_factory=ProblemContext)

    @field_validator("description")
    @classmethod
    def descriptive_text(cls, value):
        value = value.strip()
        if len(value) < 10 or "\x00" in value:
            raise ValueError("Provide at least 10 characters describing the problem.")
        return value


class ProblemPatch(StrictModel):
    status: Literal["open", "closed"]


class ProblemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    description: str
    context: dict
    status: str
    created_at: datetime


def owned_problem(db, problem_id, user_id):
    problem = db.scalar(select(SupportProblem).where(SupportProblem.id == problem_id, SupportProblem.user_id == user_id))
    if problem is None:
        fail(404, "not_found", "Problem report not found.")
    return problem


@router.get("/faq")
def list_faq(
    category: str | None = Query(default=None, max_length=50), search: str | None = Query(default=None, max_length=200),
    user: User = Depends(get_current_user),
):
    items = list(FAQ)
    if category:
        items = [item for item in items if item["category"] == category]
    if search:
        needle = search.casefold()
        items = [item for item in items if needle in (item["question"] + " " + item["answer"]).casefold()]
    return {"items": items, "categories": sorted({item["category"] for item in FAQ}), "live_support_available": False}


@router.get("/faq/{faq_id}")
def get_faq(faq_id: str, user: User = Depends(get_current_user)):
    item = next((item for item in FAQ if item["id"] == faq_id), None)
    if item is None:
        fail(404, "not_found", "FAQ not found.")
    return item


@router.post("/problems", response_model=ProblemOut, status_code=201)
def create_problem(payload: ProblemCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    application_id = payload.context.application_id
    if application_id is not None and db.scalar(select(Application.id).where(Application.id == application_id, Application.user_id == user.id)) is None:
        fail(404, "not_found", "Application not found.")
    problem = SupportProblem(user_id=user.id, description=payload.description, context=payload.context.model_dump(exclude_none=True))
    db.add(problem)
    db.commit()
    db.refresh(problem)
    return problem


@router.get("/problems")
def list_problems(
    status: Literal["open", "closed"] | None = None,
    limit: int = Query(default=30, ge=1, le=100), offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    filters = [SupportProblem.user_id == user.id]
    if status:
        filters.append(SupportProblem.status == status)
    total = db.scalar(select(func.count()).select_from(SupportProblem).where(*filters))
    items = db.scalars(select(SupportProblem).where(*filters).order_by(SupportProblem.created_at.desc(), SupportProblem.id).offset(offset).limit(limit)).all()
    return {"items": [ProblemOut.model_validate(item) for item in items], "total": total, "limit": limit, "offset": offset}


@router.get("/problems/{problem_id}", response_model=ProblemOut)
def get_problem(problem_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return owned_problem(db, problem_id, user.id)


@router.patch("/problems/{problem_id}", response_model=ProblemOut)
def update_problem(problem_id: str, payload: ProblemPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    problem = owned_problem(db, problem_id, user.id)
    problem.status = payload.status
    db.commit()
    db.refresh(problem)
    return problem
