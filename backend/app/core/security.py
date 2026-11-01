import base64
import hashlib
from datetime import timedelta, timezone
import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from sqlalchemy import update
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import fail
from app.core.time import utcnow
from app.models import AutomationSettings, MfaFactor, Preferences, Profile, User

password_hash = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class SecretBox:
    def __init__(self):
        settings = get_settings()
        key = (
            settings.encryption_key
            or base64.urlsafe_b64encode(
                hashlib.sha256((settings.jwt_secret + ":local-private-storage").encode()).digest()
            ).decode()
        )
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
    return jwt.encode(
        {
            "sub": user.id,
            "iss": settings.jwt_issuer,
            "aud": "cyberapply-api",
            "iat": now,
            "exp": now + timedelta(minutes=settings.access_token_minutes),
            "kind": "access",
            "tv": user.token_version,
            "aal": assurance,
            "auth_time": int((authenticated_at or now).replace(tzinfo=timezone.utc).timestamp()),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def decode_access(token: str) -> dict:
    settings = get_settings()
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            audience="cyberapply-api",
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "exp", "iat", "iss", "aud"]},
        )
        if claims.get("kind") != "access":
            fail(401, "invalid_token", "Invalid access token type")
        return claims
    except jwt.PyJWTError:
        fail(401, "invalid_token", "Access token is invalid or expired")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
    request: Request = None,
) -> User:
    return resolve_user(credentials, db, enforce_mfa=True, request=request)


def get_primary_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
    request: Request = None,
) -> User:
    """First-factor identity only. Use exclusively for MFA enrollment/challenge routes."""
    return resolve_user(credentials, db, enforce_mfa=False, request=request)


def resolve_user(credentials, db, *, enforce_mfa, request=None):
    if not credentials:
        fail(401, "authentication_required", "Sign in to continue")
    claims = decode_access(credentials.credentials)
    user = db.get(User, claims["sub"])
    if not user or not user.active:
        fail(401, "invalid_token", "Account is unavailable")
    if request is not None and request.method not in {"GET", "HEAD", "OPTIONS"}:
        lock_active_user(db, user)
    if claims.get("tv") != user.token_version:
        fail(401, "invalid_token", "Session has been revoked")
    factor = db.get(MfaFactor, user.id)
    if enforce_mfa and factor and factor.enabled and (claims.get("aal") != 2):
        fail(401, "mfa_required", "Complete two-factor authentication to continue")
    if request is not None and request.method not in {"GET", "HEAD", "OPTIONS"}:
        lock_active_user(db, user)
        if claims.get("tv") != user.token_version:
            fail(401, "invalid_token", "Session has been revoked")
    return user


def lock_active_user(db, user):
    changed = db.execute(
        update(User).where(User.id == user.id, User.active.is_(True)).values(token_version=User.token_version)
    )
    if changed.rowcount != 1:
        fail(401, "account_unavailable", "This account is disabled")
    db.refresh(user)
