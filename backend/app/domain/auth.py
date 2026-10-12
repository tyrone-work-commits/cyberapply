import json
import secrets
import smtplib
import ssl
import time
from datetime import timedelta
from email.message import EmailMessage
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import fail
from app.core.security import digest, ensure_user_records, get_current_user, issue_access, password_hash
from app.core.time import utcnow
from app.models import RefreshSession, User, VerificationToken

router = APIRouter(prefix="/auth", tags=["Authentication"])


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Credentials(Strict):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return value.casefold()


class Login(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class Refresh(Strict):
    refresh_token: str = Field(min_length=20, max_length=4096)


class EmailRequest(Strict):
    email: EmailStr


class TokenRequest(Strict):
    token: str = Field(min_length=20, max_length=4096)


class ResetPassword(TokenRequest):
    password: str = Field(min_length=12, max_length=128)


class PhoneRequest(Strict):
    phone: str = Field(pattern=r"^\+[1-9]\d{7,14}$")


class PhoneVerify(PhoneRequest):
    token: str = Field(pattern=r"^\d{6,10}$")


class OAuthStart(Strict):
    redirect_url: str = Field(max_length=2000)
    code_challenge: str = Field(pattern=r"^[A-Za-z0-9_-]{43,128}$")


class OAuthExchange(Strict):
    code: str = Field(min_length=10, max_length=4096)
    code_verifier: str = Field(pattern=r"^[A-Za-z0-9._~-]{43,128}$")


def provider_call(path: str, payload: dict | None = None, token: str | None = None, method="POST"):
    settings = get_settings()
    if settings.auth_mode != "supabase":
        fail(503, "provider_unconfigured", "Configure Supabase to enable this sign-in method")
    try:
        response = httpx.request(method, settings.supabase_url.rstrip("/") + "/auth/v1/" + path,
                                 json=payload, headers={"apikey": settings.supabase_anon_key,
                                                       "Authorization": "Bearer " + (token or settings.supabase_anon_key)},
                                 timeout=15, follow_redirects=False)
        if response.status_code >= 500:
            fail(503, "identity_provider_unavailable", "Authentication provider is unavailable")
        if response.status_code >= 400:
            fail(400 if response.status_code != 429 else 429, "authentication_failed",
                 "Authentication could not be completed; check the information or try again")
        if not 200 <= response.status_code < 300:
            fail(503, "identity_provider_unavailable", "Authentication provider returned an unexpected response")
        result = response.json() if response.content else {}
        if not isinstance(result, dict):
            fail(503, "identity_provider_unavailable", "Authentication provider returned an invalid response")
        return result
    except ValueError:
        fail(503, "identity_provider_unavailable", "Authentication provider returned an invalid response")
    except httpx.HTTPError:
        fail(503, "identity_provider_unavailable", "Authentication provider is unavailable")


def user_view(user: User):
    return {"id": user.id, "email": user.email, "phone": user.phone, "email_verified": user.email_verified}


def session_tokens(db: Session, user: User):
    raw = secrets.token_urlsafe(48)
    db.add(RefreshSession(user_id=user.id, token_hash=digest(raw),
                          expires_at=utcnow() + timedelta(days=get_settings().refresh_token_days)))
    db.commit()
    return {"access_token": issue_access(user), "refresh_token": raw, "token_type": "bearer",
            "expires_in": get_settings().access_token_minutes * 60, "user": user_view(user)}


def deliver_auth_email(user: User, purpose: str, raw: str):
    settings = get_settings()
    text = f"CyberApply {purpose}. Use this one-time token in the app: {raw}"
    if settings.auth_email_mode == "capture":
        directory = settings.storage_dir.parent / "auth-outbox"
        directory.mkdir(parents=True, exist_ok=True)
        # Private local developer artifact; never exposed through an API endpoint.
        (directory / (secrets.token_hex(16) + ".json")).write_text(
            json.dumps({"recipient": user.email, "purpose": purpose, "token": raw}), encoding="utf-8")
        return
    if not settings.smtp_host or not settings.smtp_from:
        fail(503, "email_unconfigured", "Authentication email delivery is not configured")
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = settings.smtp_from, user.email, "CyberApply " + purpose
    message.set_content(text)
    try:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15,
                              context=ssl.create_default_context()) as smtp:
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException):
        fail(503, "email_unavailable", "Authentication email delivery is unavailable")


def verification(db: Session, user: User, purpose: str):
    raw = secrets.token_urlsafe(48)
    # Serialize requests and make only the newest verification/reset token usable.
    db.execute(update(User).where(User.id == user.id).values(token_version=User.token_version))
    db.execute(update(VerificationToken).where(VerificationToken.user_id == user.id,
                                               VerificationToken.purpose == purpose,
                                               VerificationToken.used_at.is_(None)).values(used_at=utcnow()))
    db.add(VerificationToken(user_id=user.id, purpose=purpose, token_hash=digest(raw),
                             expires_at=utcnow() + timedelta(hours=1)))
    db.commit()
    deliver_auth_email(user, purpose, raw)


@router.get("/capabilities")
def capabilities():
    settings = get_settings()
    configured = settings.auth_mode == "supabase"
    return {"auth_mode": settings.auth_mode, "email": True, "google": configured, "apple": configured,
            "phone": configured, "external_provider_configuration_required": True,
            "email_delivery": settings.auth_email_mode if not configured else "provider"}


@router.post("/register", status_code=201)
def register(body: Credentials, db: Session = Depends(get_db)):
    if get_settings().auth_mode == "supabase":
        return provider_call("signup", body.model_dump(mode="json"))
    user = User(email=str(body.email), password_hash=password_hash.hash(body.password))
    db.add(user)
    try:
        ensure_user_records(db, user)
        db.commit()
    except IntegrityError:
        db.rollback()
        fail(409, "account_exists", "An account already exists with this email")
    verification(db, user, "verify_email")
    return {"user": user_view(user), "verification_required": True,
            "delivery": get_settings().auth_email_mode}


@router.post("/login")
def login(body: Login, db: Session = Depends(get_db)):
    if get_settings().auth_mode == "supabase":
        return provider_call("token?grant_type=password", body.model_dump(mode="json"))
    user = db.scalar(select(User).where(User.email == str(body.email).casefold()))
    valid = False
    if user and user.password_hash:
        try:
            valid = password_hash.verify(body.password, user.password_hash)
        except ValueError:
            valid = False
    else:
        password_hash.verify(body.password, DUMMY_PASSWORD)
    if not valid or not user or not user.active:
        fail(401, "invalid_credentials", "Email or password is incorrect")
    return session_tokens(db, user)


DUMMY_PASSWORD = password_hash.hash(secrets.token_urlsafe(30))


@router.post("/refresh")
def refresh(body: Refresh, db: Session = Depends(get_db)):
    if get_settings().auth_mode == "supabase":
        return provider_call("token?grant_type=refresh_token", body.model_dump())
    now = utcnow()
    old = db.scalar(select(RefreshSession).where(RefreshSession.token_hash == digest(body.refresh_token)))
    if not old or old.expires_at <= now or old.revoked_at:
        fail(401, "invalid_refresh_token", "Refresh token is invalid or expired")
    claimed = db.execute(update(RefreshSession).where(RefreshSession.id == old.id,
                                                     RefreshSession.revoked_at.is_(None)).values(revoked_at=now))
    if claimed.rowcount != 1:
        db.rollback()
        fail(401, "invalid_refresh_token", "Refresh token was already used")
    user = db.get(User, old.user_id)
    if not user or not user.active:
        fail(401, "account_unavailable", "Account is unavailable")
    return session_tokens(db, user)


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_view(user)


@router.post("/logout")
def logout(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if get_settings().auth_mode == "supabase":
        provider_call("logout?scope=global", token=request.headers["authorization"].split(" ", 1)[1])
    user.token_version += 1
    user.revoked_before = int(time.time())
    db.execute(update(RefreshSession).where(RefreshSession.user_id == user.id,
                                            RefreshSession.revoked_at.is_(None)).values(revoked_at=utcnow()))
    db.commit()
    return {"logged_out": True, "scope": "all_local_sessions" if get_settings().auth_mode == "local" else "provider_global"}


@router.post("/email/request-verification")
def request_verification(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if get_settings().auth_mode == "supabase":
        provider_call("resend", {"type": "signup", "email": user.email})
    elif not user.email_verified:
        verification(db, user, "verify_email")
    return {"message": "Verification instructions requested"}


def consume_verification(db: Session, raw: str, purpose: str):
    now = utcnow()
    row = db.scalar(select(VerificationToken).where(VerificationToken.token_hash == digest(raw),
                                                    VerificationToken.purpose == purpose))
    if not row or row.used_at or row.expires_at <= now:
        fail(400, "invalid_verification_token", "Token is invalid or expired")
    changed = db.execute(update(VerificationToken).where(VerificationToken.id == row.id,
                                                         VerificationToken.used_at.is_(None)).values(used_at=now))
    if changed.rowcount != 1:
        fail(400, "invalid_verification_token", "Token has already been used")
    return db.get(User, row.user_id)


@router.post("/email/verify")
def verify_email(body: TokenRequest, db: Session = Depends(get_db)):
    if get_settings().auth_mode != "local":
        fail(400, "provider_flow", "Use the provider email confirmation link")
    user = consume_verification(db, body.token, "verify_email")
    user.email_verified = True
    db.commit()
    return {"verified": True}


@router.post("/password/request-reset")
def request_reset(body: EmailRequest, db: Session = Depends(get_db)):
    if get_settings().auth_mode == "supabase":
        provider_call("recover", body.model_dump(mode="json"))
    else:
        user = db.scalar(select(User).where(User.email == str(body.email).casefold(), User.active.is_(True)))
        if user:
            verification(db, user, "reset_password")
    return {"message": "If the account exists, reset instructions have been requested"}


@router.post("/password/reset")
def reset_password(body: ResetPassword, db: Session = Depends(get_db)):
    if get_settings().auth_mode != "local":
        fail(400, "provider_flow", "Use the provider recovery session to update your password")
    user = consume_verification(db, body.token, "reset_password")
    user.password_hash = password_hash.hash(body.password)
    user.token_version += 1
    db.execute(update(VerificationToken).where(VerificationToken.user_id == user.id,
                                               VerificationToken.purpose == "reset_password",
                                               VerificationToken.used_at.is_(None)).values(used_at=utcnow()))
    db.execute(update(RefreshSession).where(RefreshSession.user_id == user.id).values(revoked_at=utcnow()))
    db.commit()
    return {"password_updated": True}


@router.post("/phone/request-code")
def phone_code(body: PhoneRequest):
    provider_call("otp", {"phone": body.phone, "create_user": True})
    return {"message": "Verification code requested"}


@router.post("/phone/verify")
def phone_verify(body: PhoneVerify):
    return provider_call("verify", {**body.model_dump(), "type": "sms"})


class PasswordUpdate(Strict):
    password: str = Field(min_length=12, max_length=128)
    current_password: str | None = Field(default=None, max_length=128)


@router.put("/password")
def update_password(body: PasswordUpdate, request: Request, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    if get_settings().auth_mode == "supabase":
        token = request.headers["authorization"].split(" ", 1)[1]
        provider_call("user", {"password": body.password}, token=token, method="PUT")
    else:
        if not body.current_password or not user.password_hash or not password_hash.verify(body.current_password, user.password_hash):
            fail(401, "invalid_credentials", "Current password is incorrect")
        user.password_hash = password_hash.hash(body.password)
        user.token_version += 1
        db.execute(update(RefreshSession).where(RefreshSession.user_id == user.id).values(revoked_at=utcnow()))
        db.commit()
    return {"password_updated": True}


@router.post("/oauth/{provider}/start")
def oauth_start(provider: str, body: OAuthStart):
    settings = get_settings()
    if provider not in {"google", "apple"}:
        fail(400, "unsupported_provider", "Choose Google or Apple")
    if settings.auth_mode != "supabase":
        fail(503, "provider_unconfigured", "Configure Supabase to enable this sign-in method")
    if body.redirect_url not in settings.oauth_redirect_urls:
        fail(400, "invalid_redirect", "Redirect URL is not permitted")
    query = urlencode({"provider": provider, "redirect_to": body.redirect_url,
                       "code_challenge": body.code_challenge, "code_challenge_method": "s256"})
    return {"authorization_url": settings.supabase_url.rstrip("/") + "/auth/v1/authorize?" + query,
            "flow": "pkce", "provider": provider}


@router.post("/oauth/exchange")
def oauth_exchange(body: OAuthExchange):
    return provider_call("token?grant_type=pkce", {"auth_code": body.code, "code_verifier": body.code_verifier})
