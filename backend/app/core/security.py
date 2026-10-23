import base64
import hashlib
from datetime import timedelta, timezone
from functools import lru_cache

import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from pwdlib import PasswordHash
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import fail
from app.core.time import utcnow
from app.models import AutomationSettings, MfaFactor, Preferences, Profile, User

password_hash = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)


@lru_cache(maxsize=8)
def provider_jwks(issuer: str) -> PyJWKClient:
    return PyJWKClient(issuer + "/.well-known/jwks.json", timeout=10, cache_keys=True)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class SecretBox:
    def __init__(self):
        settings = get_settings()
        key = settings.encryption_key or base64.urlsafe_b64encode(
            hashlib.sha256((settings.jwt_secret + ":local-private-storage").encode()).digest()
        ).decode()
        self.fernet = Fernet(key)

    def encrypt(self, value: str) -> str:
        return self.fernet.encrypt(value.encode()).decode()

    def decrypt(self, value: str) -> str:
        try:
            return self.fernet.decrypt(value.encode()).decode()
        except InvalidToken:
            fail(503, "secret_unavailable", "Stored credentials cannot be decrypted")


def ensure_user_records(db: Session, user: User) -> None:
    db.flush()
    if not db.get(Profile, user.id):
        db.add(Profile(user_id=user.id))
    if not db.get(Preferences, user.id):
        db.add(Preferences(user_id=user.id))
    if not db.get(AutomationSettings, user.id):
        db.add(AutomationSettings(user_id=user.id))


def issue_access(user: User, assurance: int = 1, authenticated_at=None) -> str:
    settings = get_settings()
    now = utcnow()
    return jwt.encode({"sub": user.id, "iss": settings.jwt_issuer, "aud": "cyberapply-api",
                       "iat": now, "exp": now + timedelta(minutes=settings.access_token_minutes),
                       "kind": "access", "tv": user.token_version, "aal": assurance,
                       "auth_time": int((authenticated_at or now).replace(tzinfo=timezone.utc).timestamp())}, settings.jwt_secret, algorithm="HS256")


def decode_access(token: str) -> dict:
    settings = get_settings()
    try:
        if settings.auth_mode == "supabase":
            issuer = settings.supabase_url.rstrip("/") + "/auth/v1"
            algorithm = jwt.get_unverified_header(token).get("alg")
            if not isinstance(algorithm, str) or algorithm not in {"HS256", "RS256", "ES256"}:
                fail(401, "invalid_token", "Unsupported access token")
            if algorithm == "HS256" and settings.supabase_jwt_secret:
                key = settings.supabase_jwt_secret
            elif algorithm in {"RS256", "ES256"}:
                key = provider_jwks(issuer).get_signing_key_from_jwt(token).key
            else:
                fail(401, "invalid_token", "Unsupported access token")
            claims = jwt.decode(token, key, algorithms=[algorithm], audience="authenticated", issuer=issuer,
                                options={"require": ["sub", "exp", "iat", "iss", "aud"]})
            if type(claims.get("iat")) is not int:
                fail(401, "invalid_token", "Invalid token issue time")
            if claims.get("role") != "authenticated":
                fail(401, "invalid_token", "User authentication is required")
            return claims
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], audience="cyberapply-api",
                            issuer=settings.jwt_issuer, options={"require": ["sub", "exp", "iat", "iss", "aud"]})
        if claims.get("kind") != "access":
            fail(401, "invalid_token", "Invalid access token type")
        return claims
    except jwt.PyJWTError:
        fail(401, "invalid_token", "Access token is invalid or expired")


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
                     db: Session = Depends(get_db), request: Request = None) -> User:
    return resolve_user(credentials, db, enforce_mfa=True, request=request)


def get_primary_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
                     db: Session = Depends(get_db), request: Request = None) -> User:
    """First-factor identity only. Use exclusively for MFA enrollment/challenge routes."""
    return resolve_user(credentials, db, enforce_mfa=False, request=request)


def resolve_user(credentials, db, *, enforce_mfa, request=None):
    if not credentials:
        fail(401, "authentication_required", "Sign in to continue")
    claims = decode_access(credentials.credentials)
    user = db.get(User, claims["sub"])
    if not user and get_settings().auth_mode == "supabase":
        # Identity comes exclusively from a verified provider JWT, never request fields.
        email = claims.get("email") or None
        phone = claims.get("phone") or None
        if (email is not None and not isinstance(email, str)) or (phone is not None and not isinstance(phone, str)):
            fail(401, "invalid_token", "Invalid identity claims")
        if email and db.scalar(select(User).where(User.email == email.casefold(), User.id != claims["sub"])):
            fail(409, "identity_conflict", "This email belongs to another account; link identities with the provider")
        if phone and db.scalar(select(User).where(User.phone == phone, User.id != claims["sub"])):
            fail(409, "identity_conflict", "This phone belongs to another account; link identities with the provider")
        user = User(id=claims["sub"], email=email.casefold() if email else None, phone=phone,
                    email_verified=False)
        try:
            db.add(user)
            ensure_user_records(db, user)
            db.commit()
        except IntegrityError:
            db.rollback()
            user = db.get(User, claims["sub"])
            if not user:
                fail(409, "identity_conflict", "Provider identity conflicts with an existing account")
    if not user or not user.active:
        fail(401, "invalid_token", "Account is unavailable")
    if request is not None and request.method not in {"GET", "HEAD", "OPTIONS"}:
        lock_active_user(db, user)
    if get_settings().auth_mode == "local" and claims.get("tv") != user.token_version:
        fail(401, "invalid_token", "Session has been revoked")
    factor = db.get(MfaFactor, user.id)
    if get_settings().auth_mode == "local" and enforce_mfa and factor and factor.enabled and claims.get("aal") != 2:
        fail(401, "mfa_required", "Complete two-factor authentication to continue")
    if get_settings().auth_mode == "supabase":
        if claims["iat"] <= user.revoked_before:
            fail(401, "invalid_token", "Session has been revoked")
        email, phone = claims.get("email") or None, claims.get("phone") or None
        if isinstance(email, str) and email.casefold() != user.email and db.scalar(select(User.id).where(User.email == email.casefold(), User.id != user.id)):
            fail(409, "identity_conflict", "Provider contact conflicts with an existing account")
        if isinstance(phone, str) and phone != user.phone and db.scalar(select(User.id).where(User.phone == phone, User.id != user.id)):
            fail(409, "identity_conflict", "Provider contact conflicts with an existing account")
        provider_user = trusted_provider_user(credentials.credentials, user.id) if enforce_mfa else {"id": user.id}
        lock_active_user(db, user)
        if claims["iat"] <= user.revoked_before:
            fail(401, "invalid_token", "Session has been revoked")
        factors = provider_user.get("factors", [])
        if not isinstance(factors, list) or any(not isinstance(item, dict) for item in factors):
            fail(503, "provider_unavailable", "Authentication provider is unavailable")
        if enforce_mfa and any(item.get("status") == "verified" for item in factors) and claims.get("aal") != "aal2":
            fail(401, "mfa_required", "Complete provider two-factor authentication to continue")
        email, phone = claims.get("email") or None, claims.get("phone") or None
        if (email is not None and not isinstance(email, str)) or (phone is not None and not isinstance(phone, str)):
            fail(401, "invalid_token", "Invalid identity claims")
        email = email.casefold() if email else None
        if user.email != email or user.phone != phone:
            if user.email != email:
                user.email_verified = False
            user.email, user.phone = email, phone
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                fail(409, "identity_conflict", "Provider contact conflicts with an existing account")
        if not user.email_verified and user.email and str(provider_user.get("email", "")).casefold() == user.email and provider_user.get("email_confirmed_at"):
            user.email_verified = True
            db.commit()
    if request is not None and request.method not in {"GET", "HEAD", "OPTIONS"}:
        # Serialize private mutations/uploads with account deactivation and erasure.
        lock_active_user(db, user)
        if get_settings().auth_mode == "local" and claims.get("tv") != user.token_version:
            fail(401, "invalid_token", "Session has been revoked")
        if get_settings().auth_mode == "supabase" and claims["iat"] <= user.revoked_before:
            fail(401, "invalid_token", "Session has been revoked")
    return user


def lock_active_user(db, user):
    changed = db.execute(update(User).where(User.id == user.id, User.active.is_(True))
        .values(token_version=User.token_version))
    if changed.rowcount != 1:
        fail(401, "account_unavailable", "This account is disabled")
    db.refresh(user)


def trusted_provider_user(token, user_id):
    """Trusted factor status, never editable metadata. Fail closed if unavailable."""
    import httpx
    settings = get_settings()
    try:
        response = httpx.get(settings.supabase_url.rstrip("/") + "/auth/v1/user",
            headers={"apikey": settings.supabase_anon_key, "Authorization": "Bearer " + token},
            timeout=10, follow_redirects=False)
        if not response.is_success:
            fail(503, "provider_unavailable", "Authentication provider is unavailable")
        result = response.json()
        if not isinstance(result, dict) or result.get("id") != user_id:
            fail(503, "provider_unavailable", "Authentication provider returned an invalid identity")
        return result
    except (httpx.HTTPError, ValueError):
        fail(503, "provider_unavailable", "Authentication provider is unavailable")
