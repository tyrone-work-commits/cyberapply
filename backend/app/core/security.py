import base64
import hashlib
from datetime import timedelta
from functools import lru_cache

import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import fail
from app.core.time import utcnow
from app.models import AutomationSettings, Preferences, Profile, User

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


def issue_access(user: User) -> str:
    settings = get_settings()
    now = utcnow()
    return jwt.encode({"sub": user.id, "iss": settings.jwt_issuer, "aud": "cyberapply-api",
                       "iat": now, "exp": now + timedelta(minutes=settings.access_token_minutes),
                       "kind": "access", "tv": user.token_version}, settings.jwt_secret, algorithm="HS256")


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
                     db: Session = Depends(get_db)) -> User:
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
    if get_settings().auth_mode == "local" and claims.get("tv") != user.token_version:
        fail(401, "invalid_token", "Session has been revoked")
    if get_settings().auth_mode == "supabase":
        if claims["iat"] <= user.revoked_before:
            fail(401, "invalid_token", "Session has been revoked")
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
        if not user.email_verified and user.email:
            # Provider JWT email presence is not proof of email verification.
            # Never trust editable user_metadata for this decision.
            import httpx
            settings = get_settings()
            try:
                result = httpx.get(settings.supabase_url.rstrip("/") + "/auth/v1/user",
                                   headers={"apikey": settings.supabase_anon_key,
                                            "Authorization": "Bearer " + credentials.credentials},
                                   timeout=10, follow_redirects=False)
                if result.is_success:
                    provider_user = result.json()
                    if (isinstance(provider_user, dict) and provider_user.get("id") == user.id
                            and str(provider_user.get("email", "")).casefold() == user.email
                            and provider_user.get("email_confirmed_at")):
                        user.email_verified = True
                        db.commit()
            except (httpx.HTTPError, ValueError):
                pass  # Continue unverified; external submissions remain blocked.
    return user
