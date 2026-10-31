"""Private document storage, bounded extraction, and explicitly reviewed resumes."""

from __future__ import annotations

import hashlib
import io
import multiprocessing
import re
import zipfile
from pathlib import PurePosixPath
from typing import Literal
from urllib.parse import quote
from uuid import uuid4

from defusedxml import ElementTree
from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import Response
from pydantic import Field, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import fail
from app.core.security import get_current_user
from app.core.storage import Storage
from app.core.time import utcnow
from app.domain.matching import compute_match, detect_certifications, detect_skills
from app.domain.profiles import ProfileData, StrictModel, profile_response
from app.models import Application, Document, MailDraft, Preferences, Profile, Resume, User

router = APIRouter(tags=["Documents and resumes"])
MAX_TEXT_CHARS = 200000
MAX_PDF_PAGES = 100
PDF_TIMEOUT_SECONDS = 20
SUPPORTED = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
}


class ResumeCreate(StrictModel):
    title: str = Field(default="My resume", min_length=1, max_length=255)
    text: str = Field(default="", max_length=MAX_TEXT_CHARS)
    profile_data: ProfileData = Field(default_factory=ProfileData)

    @model_validator(mode="after")
    def has_content(self):
        if not self.text.strip() and not any(self.profile_data.model_dump(exclude_defaults=True).values()):
            raise ValueError("Resume text or candidate profile data is required")
        if not self.title.strip():
            raise ValueError("Resume title cannot be blank")
        return self


class ResumeEdit(StrictModel):
    version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=255)
    text: str | None = Field(default=None, max_length=MAX_TEXT_CHARS)

    @model_validator(mode="after")
    def changes_supplied(self):
        if self.title is None and self.text is None:
            raise ValueError("A title or text change is required")
        if self.title is not None and not self.title.strip():
            raise ValueError("Resume title cannot be blank")
        return self


class ResumeReview(StrictModel):
    version: int = Field(ge=1)
    profile_data: ProfileData
    apply_to_profile: bool = False


class OptimizationInput(StrictModel):
    job_id: str | None = Field(default=None, min_length=1, max_length=36)


def _safe_filename(filename: str | None) -> str:
    filename = re.split(r"[/\\]", filename or "document")[-1]
    filename = re.sub(r"[^\w. ()-]", "_", filename).strip(" .")
    if not filename:
        return "document"
    if len(filename) > 200:
        extension = PurePosixPath(filename).suffix[:10]
        filename = filename[:190] + extension
    return filename


def _worker_memory_limit() -> None:
    """Limit parser memory in its disposable subprocess on Linux and Windows."""
    limit = 512 * 1024 * 1024
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
        return
    except (ImportError, OSError, ValueError):
        pass
    try:
        import ctypes
        from ctypes import wintypes

        class Basic(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64), ("flags", wintypes.DWORD), ("minimum_working_set", ctypes.c_size_t), ("maximum_working_set", ctypes.c_size_t), ("active_process_limit", wintypes.DWORD), ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]

        class Counters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ("read_operations", "write_operations", "other_operations", "read_bytes", "write_bytes", "other_bytes")]

        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", Counters), ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t), ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        handle = kernel.CreateJobObjectW(None, None)
        limits = Extended()
        limits.basic.flags = 0x00000100  # JOB_OBJECT_LIMIT_PROCESS_MEMORY
        limits.process_memory = limit
        if handle:
            if not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                return
            kernel.AssignProcessToJobObject(handle, kernel.GetCurrentProcess())
            # The OS closes this worker-owned handle when the disposable process exits.
    except (AttributeError, ImportError, OSError):
        pass


def _pdf_worker(connection, data: bytes) -> None:
    try:
        _worker_memory_limit()
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            connection.send(("error", "encrypted_pdf"))
            return
        if len(reader.pages) > MAX_PDF_PAGES:
            connection.send(("error", "too_many_pages"))
            return
        parts, length = [], 0
        for page in reader.pages:
            text = page.extract_text() or ""
            length += len(text)
            if length > MAX_TEXT_CHARS:
                connection.send(("error", "extracted_text_too_large"))
                return
            parts.append(text)
        connection.send(("ok", "\n\n".join(parts).strip()))
    except Exception:
        # Do not expose parser internals, filesystem paths, or document contents.
        connection.send(("error", "invalid_pdf"))
    finally:
        connection.close()


def _extract_pdf(data: bytes) -> str:
    context = multiprocessing.get_context("spawn")
    reader, writer = context.Pipe(duplex=False)
    process = context.Process(target=_pdf_worker, args=(writer, data), daemon=True)
    try:
        process.start()
        writer.close()
        if not reader.poll(PDF_TIMEOUT_SECONDS):
            fail(422, "pdf_extraction_timeout", "PDF extraction exceeded the processing limit. Use a simpler PDF, DOCX, or a manual resume.")
        try:
            state, content = reader.recv()
        except EOFError:
            fail(422, "invalid_pdf", "The PDF could not be extracted within the processing limits.")
        if state != "ok":
            messages = {"encrypted_pdf": "Encrypted PDFs are not supported. Upload an unencrypted copy.", "too_many_pages": "Resumes must have no more than 100 PDF pages.", "extracted_text_too_large": "Extracted resume text exceeds the processing limit."}
            fail(422, content, messages.get(content, "The PDF could not be read. Upload a valid PDF or provide the resume text manually."))
        return content
    finally:
        reader.close()
        writer.close()
        if process.pid:
            process.join(timeout=1)
            if process.is_alive():
                process.terminate()
                process.join(timeout=2)
            process.close()


def _extract_docx(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 1000 or sum(entry.file_size for entry in entries) > 30 * 1024 * 1024:
                fail(422, "docx_too_large", "DOCX expanded contents exceed the processing limit.")
            for entry in entries:
                parts = PurePosixPath(entry.filename).parts
                if ".." in parts or entry.filename.startswith(("/", "\\")) or "\\" in entry.filename or entry.flag_bits & 1:
                    fail(422, "invalid_docx", "The DOCX archive contains unsupported entries.")
                if entry.file_size > 10 * 1024 * 1024 or entry.file_size > max(1, entry.compress_size) * 200:
                    fail(422, "docx_too_large", "DOCX compression exceeds the processing limit.")
                if "vbaproject" in entry.filename.casefold():
                    fail(422, "invalid_docx", "Macro-enabled documents are not supported.")
            names = {entry.filename for entry in entries}
            if "word/document.xml" not in names or "[Content_Types].xml" not in names:
                fail(422, "invalid_docx", "A valid DOCX document is required.")
            entry = archive.getinfo("word/document.xml")
            if entry.file_size > 5 * 1024 * 1024:
                fail(422, "docx_too_large", "DOCX document text exceeds the processing limit.")
            document = ElementTree.fromstring(archive.read(entry))
            namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
            parts = ["".join(text.text or "" for text in paragraph.iter(namespace + "t")) for paragraph in document.iter(namespace + "p")]
            text = "\n".join(parts).strip()
            if len(text) > MAX_TEXT_CHARS:
                fail(422, "extracted_text_too_large", "Extracted resume text exceeds the processing limit.")
            return text
    except (zipfile.BadZipFile, KeyError, ValueError, ElementTree.ParseError):
        fail(422, "invalid_docx", "The DOCX could not be read. Upload a valid DOCX or provide the resume text manually.")
    except Exception as exc:
        from fastapi import HTTPException
        if isinstance(exc, HTTPException):
            raise
        fail(422, "invalid_docx", "The DOCX could not be read safely.")


def extract_text(data: bytes, extension: str) -> str:
    if extension == ".pdf":
        if not data.startswith(b"%PDF-"):
            fail(422, "invalid_pdf", "The file does not contain a PDF document.")
        return _extract_pdf(data)
    if extension == ".docx":
        if not data.startswith(b"PK"):
            fail(422, "invalid_docx", "The file does not contain a DOCX document.")
        return _extract_docx(data)
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        fail(422, "invalid_text_file", "Text resumes must use UTF-8 encoding.")
    if "\x00" in text or len(text) > MAX_TEXT_CHARS:
        fail(422, "invalid_text_file", "Text resume contents exceed the supported format or size.")
    return text.strip()


def _suggested_profile(text: str) -> dict:
    # Never infer employment history, degrees, clearance, citizenship, or years of
    # experience from loosely structured text. Every suggestion requires review.
    suggested = {"skills": detect_skills(text), "certifications": detect_certifications(text)}
    emails = re.findall(r"(?<![\w.+-])[\w.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w.-])", text)
    if emails:
        try:
            candidate = ProfileData(email=emails[0])
            suggested["email"] = str(candidate.email)
        except ValueError:
            pass
    return suggested


def document_response(document: Document) -> dict:
    return {key: getattr(document, key) for key in ("id", "kind", "filename", "content_type", "size_bytes", "sha256", "created_at")}


def resume_response(resume: Resume, *, include_text: bool = True) -> dict:
    result = {key: getattr(resume, key) for key in ("id", "document_id", "title", "profile_data", "reviewed", "is_main", "version", "target_role", "created_at", "updated_at")}
    result["extraction_status"] = "extracted" if resume.extracted_text else "manual_review_required"
    result["warnings"] = [] if resume.extracted_text else ["No readable text is available. Image-only PDFs require OCR or manually entered profile data."]
    if not resume.reviewed:
        result["warnings"].append("Extracted skills and certification mentions are suggestions; confirm candidate facts before applying.")
    if include_text:
        result["extracted_text"] = resume.extracted_text
    return result


def owned_document(db: Session, document_id: str, user_id: str) -> Document:
    document = db.scalar(select(Document).where(Document.id == document_id, Document.user_id == user_id))
    if document is None:
        fail(404, "document_not_found", "Document was not found.")
    return document


def owned_resume(db: Session, resume_id: str, user_id: str) -> Resume:
    resume = db.scalar(select(Resume).where(Resume.id == resume_id, Resume.user_id == user_id))
    if resume is None:
        fail(404, "resume_not_found", "Resume was not found.")
    return resume


def _ensure_resume_quota(db: Session, user_id: str):
    if db.scalar(select(func.count(Resume.id)).where(Resume.user_id == user_id)) >= 50:
        fail(409, "resume_limit_reached", "The limit of 50 resumes has been reached. Delete an unused resume first.")


def _upload(file: UploadFile, kind: str, db: Session, user: User) -> dict:
    settings = get_settings()
    filename = _safe_filename(file.filename)
    extension = PurePosixPath(filename).suffix.casefold()
    expected_type = SUPPORTED.get(extension)
    if expected_type is None or expected_type not in settings.upload_allowed_types:
        fail(415, "unsupported_document_type", "Upload a PDF, DOCX, or UTF-8 TXT document supported by the server.")
    provided_type = (file.content_type or "").split(";", 1)[0].strip().casefold()
    if provided_type not in (expected_type, "application/octet-stream", ""):
        fail(415, "document_type_mismatch", "The file extension and content type do not agree.")
    if db.scalar(select(func.count(Document.id)).where(Document.user_id == user.id)) >= 100:
        fail(409, "document_limit_reached", "The limit of 100 documents has been reached.")
    if kind == "resume":
        _ensure_resume_quota(db, user.id)
    data = file.file.read(settings.max_upload_bytes + 1)
    if not data:
        fail(422, "empty_document", "The uploaded document is empty.")
    if len(data) > settings.max_upload_bytes:
        fail(413, "document_too_large", "The uploaded document exceeds the server size limit.")
    text = extract_text(data, extension)
    document_id = str(uuid4())
    key = f"users/{user.id}/documents/{document_id}{extension}"
    storage = Storage()
    try:
        storage.put(key, data, expected_type)
    except Exception:
        fail(503, "storage_unavailable", "Private document storage is currently unavailable.")
    document = Document(id=document_id, user_id=user.id, kind=kind, filename=filename, content_type=expected_type, storage_key=key, size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    resume = None
    try:
        db.add(document)
        db.flush()
        if kind == "resume":
            has_main = db.scalar(select(Resume.id).where(Resume.user_id == user.id, Resume.is_main.is_(True)))
            resume = Resume(user_id=user.id, document_id=document.id, title=filename, extracted_text=text, profile_data=_suggested_profile(text), reviewed=False, is_main=has_main is None, version=1)
            db.add(resume)
        db.commit()
    except Exception:
        db.rollback()
        try:
            storage.delete(key)
        except Exception:
            pass
        raise
    return {"document": document_response(document), "resume": resume_response(resume) if resume else None, "extraction": {"status": "extracted" if text else "manual_review_required", "characters": len(text), "user_review_required": kind == "resume"}}


@router.post("/documents", status_code=201)
def upload_document(file: UploadFile = File(...), kind: Literal["resume", "cover_letter", "other"] = Form(default="resume"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _upload(file, kind, db, user)


@router.post("/resumes/upload", status_code=201)
def upload_resume(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _upload(file, "resume", db, user)


@router.get("/documents")
def list_documents(limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0, le=100000), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = select(Document).where(Document.user_id == user.id)
    total = db.scalar(select(func.count()).select_from(statement.subquery()))
    items = db.scalars(statement.order_by(Document.created_at.desc(), Document.id).offset(offset).limit(limit)).all()
    return {"items": [document_response(item) for item in items], "total": total, "limit": limit, "offset": offset}


@router.get("/documents/{document_id}")
def get_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return document_response(owned_document(db, document_id, user.id))


def _download(document: Document) -> Response:
    try:
        data = Storage().get(document.storage_key)
    except Exception:
        fail(503, "storage_unavailable", "The document is temporarily unavailable.")
    fallback = re.sub(r"[^A-Za-z0-9._-]", "_", document.filename)
    disposition = f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(document.filename, safe='')}"
    return Response(content=data, media_type=document.content_type, headers={"Content-Disposition": disposition, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/documents/{document_id}/download")
def download_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _download(owned_document(db, document_id, user.id))


@router.delete("/documents/{document_id}")
def delete_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    document = owned_document(db, document_id, user.id)
    if db.scalar(select(Resume.id).where(Resume.document_id == document.id)):
        fail(409, "document_in_use", "Delete the unused resume associated with this document first.")
    snapshots = db.scalars(select(Application.resume_snapshot).where(Application.user_id == user.id).execution_options(yield_per=100))
    if any((snapshot or {}).get("document_id") == document.id for snapshot in snapshots):
        fail(409, "document_in_use", "This document is retained as part of an application snapshot.")
    attachments = db.scalars(select(MailDraft.attachment_ids).where(MailDraft.user_id == user.id).execution_options(yield_per=100))
    if any(document.id in (ids or []) for ids in attachments):
        fail(409, "document_in_use", "The document is attached to a mail draft or sent message.")
    key = document.storage_key
    try:
        Storage().delete(key)
    except Exception:
        # Retain the key durably so retries and account erasure can find it.
        fail(503, "storage_unavailable", "File storage is unavailable. The document is retained; try deleting it again.")
    db.delete(document)
    db.commit()
    return {"deleted": True, "storage_cleanup_pending": False}


@router.post("/resumes", status_code=201)
def create_resume(payload: ResumeCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_resume_quota(db, user.id)
    has_main = db.scalar(select(Resume.id).where(Resume.user_id == user.id, Resume.is_main.is_(True)))
    data = payload.profile_data.model_dump(mode="json") if payload.profile_data.model_fields_set else _suggested_profile(payload.text)
    resume = Resume(user_id=user.id, title=payload.title.strip(), extracted_text=payload.text, profile_data=data, reviewed=False, is_main=has_main is None, version=1)
    db.add(resume)
    db.commit()
    return resume_response(resume)


@router.get("/resumes")
def list_resumes(limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0, le=100000), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = select(Resume).where(Resume.user_id == user.id)
    total = db.scalar(select(func.count()).select_from(statement.subquery()))
    items = db.scalars(statement.order_by(Resume.is_main.desc(), Resume.created_at.desc(), Resume.id).offset(offset).limit(limit)).all()
    return {"items": [resume_response(item, include_text=False) for item in items], "total": total, "limit": limit, "offset": offset}


@router.get("/resumes/{resume_id}")
def get_resume(resume_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return resume_response(owned_resume(db, resume_id, user.id))


@router.put("/resumes/{resume_id}")
def edit_resume(resume_id: str, payload: ResumeEdit, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    resume = owned_resume(db, resume_id, user.id)
    if resume.version != payload.version:
        fail(409, "resume_version_conflict", "The resume changed. Reload it before editing.")
    values = {"reviewed": False, "updated_at": utcnow(), "version": resume.version + 1}
    if payload.title is not None:
        values["title"] = payload.title.strip()
    if payload.text is not None:
        values["extracted_text"] = payload.text
        values["profile_data"] = _suggested_profile(payload.text)
        if payload.text != resume.extracted_text:
            # Editing extracted text does not rewrite the original PDF/DOCX.
            # The edited version becomes a text resume, so downloads/submissions
            # cannot accidentally use the stale source file.
            values["document_id"] = None
    result = db.execute(update(Resume).where(Resume.id == resume.id, Resume.user_id == user.id, Resume.version == payload.version).values(**values))
    if result.rowcount != 1:
        db.rollback()
        fail(409, "resume_version_conflict", "The resume changed. Reload it before editing.")
    db.commit()
    db.refresh(resume)
    return resume_response(resume)


@router.post("/resumes/{resume_id}/review")
def review_resume(resume_id: str, payload: ResumeReview, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    resume = owned_resume(db, resume_id, user.id)
    if resume.version != payload.version:
        fail(409, "resume_version_conflict", "The resume changed. Reload it before confirming facts.")
    data = payload.profile_data.model_dump(mode="json")
    result = db.execute(update(Resume).where(Resume.id == resume.id, Resume.user_id == user.id, Resume.version == payload.version).values(profile_data=data, reviewed=True, updated_at=utcnow(), version=resume.version + 1))
    if result.rowcount != 1:
        db.rollback()
        fail(409, "resume_version_conflict", "The resume changed. Reload it before confirming facts.")
    profile = None
    if payload.apply_to_profile:
        profile = db.get(Profile, user.id)
        if profile is None:
            profile = Profile(user_id=user.id)
            db.add(profile)
        profile.data, profile.confirmed, profile.updated_at = data, True, utcnow()
    db.commit()
    db.refresh(resume)
    return {"resume": resume_response(resume), "profile": profile_response(profile) if profile else None}


@router.post("/resumes/{resume_id}/select")
def select_resume(resume_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    resume = owned_resume(db, resume_id, user.id)
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    db.execute(update(Resume).where(Resume.user_id == user.id).values(is_main=False))
    db.execute(update(Resume).where(Resume.id == resume.id, Resume.user_id == user.id).values(is_main=True))
    db.commit()
    db.refresh(resume)
    return resume_response(resume)


@router.get("/resumes/{resume_id}/download")
def download_resume(resume_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    resume = owned_resume(db, resume_id, user.id)
    if resume.document_id:
        return _download(owned_document(db, resume.document_id, user.id))
    return Response(content=resume.extracted_text, media_type="text/plain", headers={"Content-Disposition": "attachment; filename=\"resume.txt\"", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.delete("/resumes/{resume_id}")
def delete_resume(resume_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    resume = owned_resume(db, resume_id, user.id)
    if db.scalar(select(Application.id).where(Application.resume_id == resume.id)):
        fail(409, "resume_in_use", "This resume is referenced by an application and must be retained.")
    was_main = resume.is_main
    db.delete(resume)
    db.flush()
    if was_main:
        next_resume = db.scalar(select(Resume).where(Resume.user_id == user.id).order_by(Resume.created_at.desc(), Resume.id).limit(1))
        if next_resume:
            next_resume.is_main = True
    db.commit()
    return {"deleted": True}


def analyze_resume(resume: Resume) -> dict:
    text = resume.extracted_text or ""
    sections = {name: bool(re.search(pattern, text, flags=re.I | re.M)) for name, pattern in {
        "summary": r"^\s*(?:professional )?(?:summary|profile)\s*[:\n]",
        "experience": r"^\s*(?:(?:work|professional) )?experience\s*[:\n]",
        "education": r"^\s*education\s*[:\n]",
        "skills": r"^\s*(?:(?:technical|core) )?skills\s*[:\n]",
        "certifications": r"^\s*certifications?\s*[:\n]",
    }.items()}
    suggestions = []
    if not text:
        suggestions.append({"code": "manual_text_required", "message": "Provide readable resume text or reviewed profile data; no OCR has been performed."})
    if not resume.reviewed:
        suggestions.append({"code": "review_extraction", "message": "Review extracted candidate facts, including certification mentions, before applying."})
    for section in ("experience", "education", "skills"):
        if text and not sections[section]:
            suggestions.append({"code": f"section_{section}", "message": f"Consider a clear {section} heading if the corresponding information is present. A missing heading does not prove the information is absent."})
    word_count = len(re.findall(r"\b\w+\b", text))
    if word_count > 1500:
        suggestions.append({"code": "length_review", "message": "Review length and relevance; the extracted text contains more than 1,500 words."})
    if text and not re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text):
        suggestions.append({"code": "contact_email", "message": "Check that a reachable contact email is present in your resume or confirmed profile."})
    return {"analysis_kind": "heuristic_resume_checks", "resume_id": resume.id, "version": resume.version, "reviewed": resume.reviewed, "word_count": word_count, "sections_detected": sections, "suggestions": suggestions, "limitations": ["Text extraction cannot verify visual layout, credential validity, ATS parsing, or hiring outcomes.", "Suggestions are deterministic checks for manual review; no AI rewrite or employer submission occurs."]}


@router.get("/resumes/{resume_id}/analysis")
def resume_analysis(resume_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return analyze_resume(owned_resume(db, resume_id, user.id))


@router.post("/resumes/{resume_id}/optimize")
def optimization_suggestions(resume_id: str, payload: OptimizationInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    resume = owned_resume(db, resume_id, user.id)
    result = analyze_resume(resume)
    result["optimization_kind"] = "heuristic_manual_suggestions"
    result["match"] = None
    if payload.job_id:
        from app.domain.jobs import owned_job
        job = owned_job(db, payload.job_id, user.id)
        match = compute_match(job, resume.profile_data, db.get(Preferences, user.id))
        match["candidate_data_reviewed"] = resume.reviewed
        if not resume.reviewed:
            match["eligible"] = False
            match["blockers"].append("Resume facts require user review.")
            match["reasons"].append("Candidate facts are preliminary extraction suggestions until the user reviews them.")
        result["match"] = match
        for skill in match["missing_skills"]:
            result["suggestions"].append({"code": "skill_gap", "skill": skill, "message": f"The listing mentions {skill}. Add truthful supporting experience only if you have it; otherwise retain this as a skill gap."})
        for certificate in match["missing_certifications"]:
            result["suggestions"].append({"code": "certification_gap", "certification": certificate, "message": f"The listing requires {certificate}. Do not claim it unless you hold the credential."})
    return result
