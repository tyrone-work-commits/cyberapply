"""Authenticator MFA with scoped challenges, replay protection and recovery codes."""
import base64
import secrets
from datetime import timedelta, timezone
from uuid import UUID

import pyotp
import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Depends, Request
from pydantic import Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import fail
from app.core.security import (
    SecretBox,
    decode_access,
    digest,
    get_current_user,
    get_primary_user,
    lock_active_user,
    password_hash,
    trusted_provider_user,
)
from app.core.time import utcnow
from app.domain.auth import Strict, provider_call, session_tokens
from app.models import AuthChallenge, MfaFactor, RefreshSession, User

router = APIRouter(prefix="/auth/mfa", tags=["Two-factor authentication"])


class Proof(Strict):
    password: str | None = Field(default=None, max_length=128)
    code: str | None = Field(default=None, max_length=64)


class CodeInput(Strict):
    code: str = Field(min_length=6, max_length=64)


class LoginVerification(CodeInput):
    challenge_token: str = Field(min_length=20, max_length=200)


class ProviderChallenge(Strict):
    factor_id: UUID


class ProviderVerification(ProviderChallenge):
    challenge_id: UUID
    code: str = Field(pattern=r"^\d{6}$")


def locked(factor):
    if factor and factor.locked_until and factor.locked_until > utcnow():
        fail(429, "mfa_locked", "Too many incorrect codes. Try again in 15 minutes.")


def failure(db, factor, challenge=None):
    count = factor.failed_checks + 1 if not factor.locked_until or factor.locked_until > utcnow() else 1
    db.execute(update(MfaFactor).where(MfaFactor.user_id == factor.user_id, MfaFactor.version == factor.version)
        .values(failed_checks=count, locked_until=utcnow() + timedelta(minutes=15) if count >= 5 else None,
                version=factor.version + 1))
    if challenge:
        db.execute(update(AuthChallenge).where(AuthChallenge.id == challenge.id).values(attempts=AuthChallenge.attempts + 1))
    db.commit()  # Persist attempts even though the request below fails.
    fail(401, "invalid_mfa_code", "That authenticator or recovery code is invalid or already used.")


def verify_factor(db, user, code, *, challenge=None, setup=False):
    factor = db.get(MfaFactor, user.id)
    if not factor or (not setup and not factor.enabled):
        fail(409, "mfa_not_enabled", "Two-factor authentication is not enabled")
    # Serialize verification and failed-attempt accounting on SQLite and PostgreSQL.
    db.execute(update(MfaFactor).where(MfaFactor.user_id == user.id).values(updated_at=MfaFactor.updated_at))
    db.refresh(factor)
    locked(factor)
    if setup and (factor.enabled or not factor.setup_expires_at or factor.setup_expires_at <= utcnow()):
        fail(409, "mfa_setup_expired", "Restart authenticator setup")
    cleaned = (code or "").strip().replace("-", "").lower()
    counter = int(utcnow().replace(tzinfo=timezone.utc).timestamp()) // 30
    matched = None
    totp = pyotp.TOTP(SecretBox().decrypt(factor.secret_encrypted))
    if len(cleaned) == 6 and cleaned.isdigit():
        for candidate in [counter, counter - 1, counter + 1]:
            if candidate > factor.last_counter and pyotp.utils.strings_equal(totp.at(candidate * 30), cleaned):
                matched = candidate
                break
    recovery = next((item for item in factor.recovery_hashes if secrets.compare_digest(item, digest(cleaned))), None) if not setup else None
    if matched is None and recovery is None:
        failure(db, factor, challenge)
    values = {"failed_checks": 0, "locked_until": None, "version": factor.version + 1}
    if matched is not None:
        values["last_counter"] = matched
    else:
        values["recovery_hashes"] = [item for item in factor.recovery_hashes if item != recovery]
    changed = db.execute(update(MfaFactor).where(MfaFactor.user_id == user.id, MfaFactor.version == factor.version).values(**values))
    if changed.rowcount != 1:
        db.rollback()
        fail(401, "mfa_code_used", "This code was already used. Wait for the next code.")
    db.refresh(factor)
    return factor


def revoke_security_sessions(db, user):
    user.token_version += 1
    db.execute(update(RefreshSession).where(RefreshSession.user_id == user.id).values(revoked_at=utcnow()))
    db.execute(update(AuthChallenge).where(AuthChallenge.user_id == user.id, AuthChallenge.consumed_at.is_(None)).values(consumed_at=utcnow()))


def recovery_codes(factor):
    codes = [secrets.token_hex(16) for _ in range(10)]
    factor.recovery_hashes = [digest(code) for code in codes]
    return codes


def require_proof(db, user, proof, request=None):
    if get_settings().auth_mode == "supabase":
        if request is None:
            fail(401, "reauthentication_required", "Sign in again before this action")
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        claims = decode_access(token)
        # Provider refresh iat does not prove a fresh sign-in. Check trusted auth-method time.
        methods = claims.get("amr", [])
        times = [item.get("timestamp") for item in methods if isinstance(item, dict) and type(item.get("timestamp")) is int] if isinstance(methods, list) else []
        now = int(utcnow().replace(tzinfo=timezone.utc).timestamp())
        if not times or max(times) < now - 300 or max(times) > now + 60:
            fail(401, "reauthentication_required", "Sign in again, including your second factor, before this action")
        return
    if not proof.password or not user.password_hash or not password_hash.verify(proof.password, user.password_hash):
        fail(401, "invalid_credentials", "Current password is incorrect")
    factor = db.get(MfaFactor, user.id)
    if factor and factor.enabled:
        if not proof.code:
            fail(401, "mfa_code_required", "Enter a new authenticator code or an unused recovery code")
        verify_factor(db, user, proof.code)


def login_challenge(db, user):
    lock_active_user(db, user)
    factor = db.get(MfaFactor, user.id)
    locked(factor)
    raw = secrets.token_urlsafe(40)
    db.add(AuthChallenge(user_id=user.id, token_hash=digest(raw), purpose="login", security_version=user.token_version,
                         expires_at=utcnow() + timedelta(minutes=5)))
    db.commit()
    return {"mfa_required": True, "challenge_token": raw, "expires_in": 300, "recovery_available": True}


@router.post("/verify-login")
def verify_login(payload: LoginVerification, db: Session = Depends(get_db)):
    if get_settings().auth_mode != "local":
        fail(400, "provider_flow", "Complete provider two-factor verification")
    challenge = db.scalar(select(AuthChallenge).where(AuthChallenge.token_hash == digest(payload.challenge_token)))
    user = db.get(User, challenge.user_id) if challenge else None
    if user and user.active:
        lock_active_user(db, user)
        db.refresh(challenge)
    if not challenge or not user or not user.active or challenge.purpose != "login" or challenge.expires_at <= utcnow() or challenge.consumed_at or challenge.attempts >= 5 or challenge.security_version != user.token_version:
        fail(401, "mfa_challenge_invalid", "The verification session ended. Sign in again.")
    verify_factor(db, user, payload.code, challenge=challenge)
    changed = db.execute(update(AuthChallenge).where(AuthChallenge.id == challenge.id, AuthChallenge.consumed_at.is_(None),
        AuthChallenge.expires_at > utcnow(), AuthChallenge.attempts < 5).values(consumed_at=utcnow()))
    if changed.rowcount != 1:
        db.rollback()
        fail(401, "mfa_challenge_invalid", "The verification session was already used")
    return session_tokens(db, user, assurance=2)


@router.get("/status")
def status(request: Request, db: Session = Depends(get_db), user: User = Depends(get_primary_user)):
    if get_settings().auth_mode == "supabase":
        token = request.headers["authorization"].split(" ", 1)[1]
        provider = trusted_provider_user(token, user.id)
        factors = [{"id": item["id"], "status": item.get("status"), "friendly_name": item.get("friendly_name"), "factor_type": item.get("factor_type")}
                   for item in provider.get("factors", []) if isinstance(item, dict) and item.get("id")]
        claims = decode_access(token)
        enabled = any(item["status"] == "verified" for item in factors)
        return {"mode": "supabase", "enabled": enabled, "verification_required": enabled and claims.get("aal") != "aal2", "factors": factors}
    factor = db.get(MfaFactor, user.id)
    return {"mode": "local", "enabled": bool(factor and factor.enabled),
            "recovery_codes_remaining": len(factor.recovery_hashes) if factor and factor.enabled else 0}


@router.post("/enroll")
def enroll(payload: Proof, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_proof(db, user, payload, request)
    if get_settings().auth_mode == "supabase":
        token = request.headers["authorization"].split(" ", 1)[1]
        return provider_call("factors", {"factor_type": "totp", "friendly_name": "CyberApply authenticator"}, token=token)
    factor = db.get(MfaFactor, user.id)
    if factor and factor.enabled:
        fail(409, "mfa_already_enabled", "An authenticator is already enabled")
    secret = pyotp.random_base32()
    if factor is None:
        factor = MfaFactor(user_id=user.id)
        db.add(factor)
    factor.secret_encrypted = SecretBox().encrypt(secret)
    factor.enabled, factor.last_counter = False, -1
    factor.recovery_hashes, factor.failed_checks, factor.locked_until = [], 0, None
    factor.setup_expires_at = utcnow() + timedelta(minutes=5)
    db.commit()
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email or user.phone or "CyberApply", issuer_name="CyberApply")
    svg = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage).to_string()
    return {"mode": "local", "secret": secret, "uri": uri, "qr_code": "data:image/svg+xml;base64," + base64.b64encode(svg).decode()}


@router.post("/confirm")
def confirm(payload: CodeInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if get_settings().auth_mode != "local":
        fail(400, "provider_flow", "Use provider challenge verification")
    factor = verify_factor(db, user, payload.code, setup=True)
    factor.enabled, factor.setup_expires_at = True, None
    codes = recovery_codes(factor)
    revoke_security_sessions(db, user)
    return {"enabled": True, "recovery_codes": codes, "session": session_tokens(db, user, assurance=2)}


@router.post("/disable")
def disable(payload: Proof, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if get_settings().auth_mode != "local":
        fail(400, "provider_flow", "Remove the provider authenticator factor")
    require_proof(db, user, payload, request)
    factor = db.get(MfaFactor, user.id)
    if factor:
        factor.enabled, factor.secret_encrypted, factor.recovery_hashes = False, "", []
        factor.setup_expires_at = None
    revoke_security_sessions(db, user)
    return {"enabled": False, "session": session_tokens(db, user)}


@router.post("/recovery-codes")
def regenerate(payload: Proof, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_proof(db, user, payload, request)
    factor = db.get(MfaFactor, user.id)
    if get_settings().auth_mode != "local" or not factor or not factor.enabled:
        fail(409, "mfa_not_enabled", "Use an enabled local authenticator")
    codes = recovery_codes(factor)
    revoke_security_sessions(db, user)
    return {"recovery_codes": codes, "session": session_tokens(db, user, assurance=2)}


@router.post("/provider/challenge")
def provider_challenge(payload: ProviderChallenge, request: Request, user: User = Depends(get_primary_user)):
    token = request.headers["authorization"].split(" ", 1)[1]
    return provider_call(f"factors/{payload.factor_id}/challenge", {}, token=token)


@router.post("/provider/verify")
def provider_verify(payload: ProviderVerification, request: Request, user: User = Depends(get_primary_user)):
    token = request.headers["authorization"].split(" ", 1)[1]
    return provider_call(f"factors/{payload.factor_id}/verify", {"challenge_id": str(payload.challenge_id), "code": payload.code}, token=token)


@router.delete("/provider/factors/{factor_id}")
def provider_remove(factor_id: UUID, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_proof(db, user, Proof(), request)
    token = request.headers["authorization"].split(" ", 1)[1]
    result = provider_call(f"factors/{factor_id}", token=token, method="DELETE")
    user.revoked_before = int(utcnow().replace(tzinfo=timezone.utc).timestamp())
    db.commit()
    return result
