"""Independent identity and provider-boundary regressions; never use live services."""

from datetime import timedelta
from uuid import uuid4

import httpx
import jwt
import pytest
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models import User


def provider_settings(settings):
    settings.auth_mode = "supabase"
    settings.supabase_url = "https://identity.example.com"
    settings.supabase_anon_key = "public-test-provider-key"
    settings.supabase_jwt_secret = "private-test-provider-signing-secret-32-chars"


def provider_headers(settings, identifier, *, email=None, phone=None):
    claims = {
        "sub": identifier, "email": email, "phone": phone,
        "aud": "authenticated", "role": "authenticated",
        "iss": settings.supabase_url + "/auth/v1",
        "iat": utcnow(), "exp": utcnow() + timedelta(minutes=30),
    }
    token = jwt.encode(claims, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": "Bearer " + token}


def test_provider_contact_change_resets_email_verification(client, db, user, settings, monkeypatch):
    provider_settings(settings)
    user.phone = "+2348000000001"
    db.commit()
    new_email = "updated@example.com"
    new_phone = "+2348000000002"
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: httpx.Response(200, json={"id": user.id, "email": new_email, "email_confirmed_at": None}))
    response = client.get("/api/v1/auth/me", headers=provider_headers(settings, user.id, email=new_email, phone=new_phone))
    assert response.status_code == 200, response.text
    assert response.json()["email"] == new_email and response.json()["phone"] == new_phone
    assert response.json()["email_verified"] is False
    db.refresh(user)
    assert user.email == new_email and user.phone == new_phone and not user.email_verified


def test_provider_removed_phone_is_removed_locally(client, db, user, settings, monkeypatch):
    provider_settings(settings)
    user.phone = "+2348000000003"
    db.commit()
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: httpx.Response(200, json={"id": user.id, "email": user.email, "factors": []}))
    response = client.get("/api/v1/auth/me", headers=provider_headers(settings, user.id, email=user.email))
    assert response.status_code == 200 and response.json()["phone"] is None
    db.refresh(user)
    assert user.phone is None and user.email_verified


@pytest.mark.parametrize("existing_identity", [False, True])
def test_provider_phone_conflict_is_sanitized_and_atomic(client, db, user, other_user, settings, monkeypatch, existing_identity):
    provider_settings(settings)
    other_user.phone = "+2348000000004"
    db.commit()
    original_email = user.email
    identifier = user.id if existing_identity else str(uuid4())
    email = user.email if existing_identity else None
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: pytest.fail("A conflicting identity must stop before network verification"))
    response = client.get("/api/v1/auth/me", headers=provider_headers(settings, identifier, email=email, phone=other_user.phone))
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "identity_conflict"
    assert other_user.phone not in response.text and other_user.email not in response.text
    db.refresh(user)
    assert user.email == original_email and user.phone is None
    if not existing_identity:
        assert db.get(User, identifier) is None


def test_provider_changed_email_conflict_preserves_previous_contact(client, db, user, other_user, settings, monkeypatch):
    provider_settings(settings)
    original_email = user.email
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: pytest.fail("A conflicting identity must stop before network verification"))
    response = client.get("/api/v1/auth/me", headers=provider_headers(settings, user.id, email=other_user.email))
    assert response.status_code == 409 and response.json()["detail"]["code"] == "identity_conflict"
    db.refresh(user)
    assert user.email == original_email and user.email_verified


@pytest.mark.parametrize("kind", ["wrong_email", "wrong_id", "array", "html", "unavailable"])
def test_provider_confirmation_cannot_verify_mismatched_or_invalid_identity(client, db, user, settings, monkeypatch, kind):
    provider_settings(settings)
    user.email_verified = False
    db.commit()
    provider_user = {"id": user.id, "email": user.email, "email_confirmed_at": "2026-10-11T12:00:00Z"}
    if kind == "wrong_email":
        provider_user["email"] = "someone-else@example.com"
    if kind == "wrong_id":
        provider_user["id"] = str(uuid4())
    if kind == "array":
        result = httpx.Response(200, json=[provider_user])
    elif kind == "html":
        result = httpx.Response(200, content=b"<html>Identity gateway unavailable</html>")
    elif kind == "unavailable":
        result = httpx.Response(503, json={"error": "Unavailable"})
    else:
        result = httpx.Response(200, json=provider_user)
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: result)
    response = client.get("/api/v1/auth/me", headers=provider_headers(settings, user.id, email=user.email))
    assert response.status_code == (200 if kind == "wrong_email" else 503)
    if kind == "wrong_email":
        assert response.json()["email_verified"] is False
    else:
        assert response.json()["detail"]["code"] == "provider_unavailable"
    db.refresh(user)
    assert not user.email_verified


def test_provider_matching_confirmed_contact_is_verified(client, db, user, settings, monkeypatch):
    provider_settings(settings)
    user.email_verified = False
    db.commit()
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: httpx.Response(200, json={"id": user.id, "email": user.email.upper(), "email_confirmed_at": "2026-10-11T12:00:00Z"}))
    response = client.get("/api/v1/auth/me", headers=provider_headers(settings, user.id, email=user.email))
    assert response.status_code == 200 and response.json()["email_verified"] is True


@pytest.mark.parametrize("status,payload", [(200, b"<html>private-provider-secret</html>"), (200, b'["private-provider-secret"]'), (302, b""), (307, b"{}")])
def test_provider_invalid_responses_fail_safely(client, settings, monkeypatch, status, payload):
    provider_settings(settings)

    def invalid_response(method, url, **kwargs):
        assert kwargs["follow_redirects"] is False
        return httpx.Response(status, content=payload, headers={"Location": "https://unexpected.example.com"}, request=httpx.Request(method, url))

    monkeypatch.setattr("app.domain.auth.httpx.request", invalid_response)
    response = client.post("/api/v1/auth/login", json={"email": "candidate@example.com", "password": "A-test-password-2026"})
    assert response.status_code == 503, response.text
    assert response.json()["detail"]["code"] == "identity_provider_unavailable"
    assert "private-provider-secret" not in response.text and "unexpected.example.com" not in response.text


def test_provider_no_content_operation_is_supported(client, settings, monkeypatch):
    provider_settings(settings)
    monkeypatch.setattr("app.domain.auth.httpx.request", lambda method, url, **kwargs: httpx.Response(204, request=httpx.Request(method, url)))
    response = client.post("/api/v1/auth/password/request-reset", json={"email": "candidate@example.com"})
    assert response.status_code == 200


def test_identity_insert_race_recovers_at_flush(client, db, user, settings, monkeypatch):
    """Simulate a concurrent insert appearing between first lookup and flush.

    This deliberately avoids concurrent use of SQLite StaticPool's one shared
    connection. The unique constraint and rollback/reload execute normally.
    """
    provider_settings(settings)
    original_get = Session.get
    hidden_once = False

    def initial_lookup_misses(session, entity, identifier, *args, **kwargs):
        nonlocal hidden_once
        if entity is User and identifier == user.id and not hidden_once:
            hidden_once = True
            return None
        return original_get(session, entity, identifier, *args, **kwargs)

    monkeypatch.setattr(Session, "get", initial_lookup_misses)
    # No contact claims bypass the preliminary email/phone conflict lookup and
    # isolate the concurrent primary-key insert recovery path.
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: httpx.Response(200, json={"id": user.id, "factors": []}))
    response = client.get("/api/v1/auth/me", headers=provider_headers(settings, user.id))
    assert response.status_code == 200, response.text
    assert response.json()["id"] == user.id and hidden_once
