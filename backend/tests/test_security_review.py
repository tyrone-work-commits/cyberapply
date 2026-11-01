"""Local identity boundaries after removal of external identity integration."""

from datetime import timedelta
from uuid import uuid4

import jwt
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.time import utcnow
from app.models import User


def token(settings, subject, **updates):
    claims = {
        "sub": subject,
        "iss": settings.jwt_issuer,
        "aud": "cyberapply-api",
        "iat": utcnow(),
        "exp": utcnow() + timedelta(minutes=30),
        "kind": "access",
        "tv": 0,
        "aal": 1,
    }
    claims.update(updates)
    return {"Authorization": "Bearer " + jwt.encode(claims, settings.jwt_secret, algorithm="HS256")}


def test_unknown_subject_cannot_create_an_account_from_token_claims(client, db, settings):
    identifier = str(uuid4())
    response = client.get("/api/v1/auth/me", headers=token(settings, identifier, email="claims@example.test"))
    assert response.status_code == 401
    assert db.get(User, identifier) is None


def test_identity_claims_cannot_replace_saved_contact_or_verification(client, db, user, settings):
    original = (user.email, user.phone, user.email_verified)
    response = client.get(
        "/api/v1/auth/me",
        headers=token(
            settings,
            user.id,
            email="different@example.test",
            phone="+2348000000000",
            email_confirmed_at="2026-01-01",
        ),
    )
    assert response.status_code == 200
    db.refresh(user)
    assert (user.email, user.phone, user.email_verified) == original
    assert response.json()["email"] == original[0]


@pytest.mark.parametrize(
    "updates",
    [
        {"iss": "https://identity.example.test/auth"},
        {"aud": "authenticated"},
        {"kind": "refresh"},
        {"tv": 99},
    ],
)
def test_external_or_revoked_identity_tokens_are_rejected(client, user, settings, updates):
    assert client.get("/api/v1/auth/me", headers=token(settings, user.id, **updates)).status_code == 401


@pytest.mark.parametrize(
    "path",
    [
        "/auth/oauth/google/start",
        "/auth/oauth/apple/start",
        "/auth/oauth/exchange",
        "/auth/phone/request-code",
        "/auth/phone/verify",
        "/auth/mfa/provider/challenge",
        "/auth/mfa/provider/verify",
    ],
)
def test_removed_identity_routes_make_no_outbound_requests(client, monkeypatch, path):
    monkeypatch.setattr(
        "httpx.request", lambda *args, **kwargs: pytest.fail("No identity service is connected")
    )
    assert client.post("/api/v1" + path, json={}).status_code == 404


def test_standalone_prototype_cannot_be_enabled_as_a_production_auth_service():
    with pytest.raises(ValidationError, match="local/test use only"):
        Settings(environment="production", _env_file=None)
    with pytest.raises(ValidationError):
        Settings(auth_mode="external", _env_file=None)
