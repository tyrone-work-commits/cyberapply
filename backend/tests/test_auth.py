import json

import jwt
import pytest

from app.core.security import digest
from app.core.time import utcnow
from app.models import RefreshSession


def test_email_registration_verification_login_refresh_logout(client, settings):
    credentials = {"email": "new@example.com", "password": "A-strong-password-2026"}
    response = client.post("/api/v1/auth/register", json=credentials)
    assert response.status_code == 201, response.text
    assert response.json()["verification_required"] is True
    captured = list((settings.storage_dir.parent / "auth-outbox").glob("*.json"))
    token = json.loads(captured[0].read_text())["token"]
    assert client.post("/api/v1/auth/email/verify", json={"token": token}).status_code == 200
    assert client.post("/api/v1/auth/email/verify", json={"token": token}).status_code == 400
    login = client.post("/api/v1/auth/login", json=credentials).json()
    headers = {"Authorization": "Bearer " + login["access_token"]}
    assert client.get("/api/v1/auth/me", headers=headers).json()["email_verified"] is True
    fresh = client.post("/api/v1/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert fresh.status_code == 200
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": login["refresh_token"]}).status_code == 401
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": fresh.json()["refresh_token"]}).status_code == 401


def test_reset_revokes_existing_tokens_and_hides_account_existence(client, user, headers, settings):
    assert client.post("/api/v1/auth/password/request-reset", json={"email": user.email}).status_code == 200
    token = json.loads(next((settings.storage_dir.parent / "auth-outbox").glob("*.json")).read_text())["token"]
    payload = {"token": token, "password": "Replacement-strong-password-2026"}
    assert client.post("/api/v1/auth/password/reset", json=payload).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
    assert client.post("/api/v1/auth/password/reset", json=payload).status_code == 400
    assert client.post("/api/v1/auth/login", json={"email": user.email, "password": payload["password"]}).status_code == 200
    existing = client.post("/api/v1/auth/password/request-reset", json={"email": user.email}).json()
    missing = client.post("/api/v1/auth/password/request-reset", json={"email": "missing@example.com"}).json()
    assert existing == missing


def test_auth_validation_never_echoes_password(client):
    response = client.post("/api/v1/auth/register", json={"email": "bad", "password": "private"})
    assert response.status_code == 422
    assert "private" not in response.text
    assert "input" not in response.text


def test_forged_expired_and_wrong_audience_token_rejected(client, user, settings):
    claims = {"sub": user.id, "iss": settings.jwt_issuer, "aud": "wrong", "exp": 9999999999,
              "iat": utcnow(), "kind": "access", "tv": 0}
    for secret, audience, exp in [("attacker-signing-key-with-32-characters", "cyberapply-api", 9999999999),
                                  (settings.jwt_secret, "wrong", 9999999999),
                                  (settings.jwt_secret, "cyberapply-api", 1)]:
        claims.update(aud=audience, exp=exp)
        token = jwt.encode(claims, secret, algorithm="HS256")
        assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401


def test_retired_phone_and_oauth_routes_are_not_available(client):
    assert client.get("/api/v1/auth/capabilities").json()["phone"] is False
    assert client.post("/api/v1/auth/phone/request-code", json={"phone": "+2348000000000"}).status_code == 404
    assert client.post("/api/v1/auth/oauth/google/start", json={
        "redirect_url": "http://localhost:3000/auth/callback", "code_challenge": "A" * 43}).status_code == 404


def test_change_password_requires_current_password_and_revokes_session(client, user, headers):
    payload = {"password": "New-password-with-good-length-2026", "current_password": "wrong"}
    assert client.put("/api/v1/auth/password", headers=headers, json=payload).status_code == 401
    payload["current_password"] = "Strong-test-password-2026"
    assert client.put("/api/v1/auth/password", headers=headers, json=payload).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_no_auth_sensitive_endpoints(client):
    for path in ["/api/v1/auth/me", "/api/v1/profiles/me", "/api/v1/jobs", "/api/v1/applications", "/api/v1/inbox/messages"]:
        assert client.get(path).status_code == 401, path


def test_upload_request_limit_and_rate_limit(client, settings):
    settings.request_max_bytes = 20
    assert client.post("/api/v1/auth/login", content=b"x" * 21).status_code == 413
    settings.request_max_bytes = 10000
    settings.auth_rate_limit = 1
    client.post("/api/v1/auth/login", json={"email": "none@example.com", "password": "bad"})
    assert client.post("/api/v1/auth/login", json={"email": "none@example.com", "password": "bad"}).status_code == 429


def test_refresh_expiration(client, db, user):
    from datetime import timedelta
    raw = "expired-refresh-token-long-enough"
    db.add(RefreshSession(user_id=user.id, token_hash=digest(raw), expires_at=utcnow() - timedelta(seconds=1)))
    db.commit()
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": raw}).status_code == 401


@pytest.mark.parametrize("invalid_token", ["", "r" * 4097])
def test_refresh_rejects_missing_or_oversized_token(client, monkeypatch, invalid_token):
    calls = []
    monkeypatch.setattr("httpx.request", lambda *a, **k: calls.append(a))
    response = client.post("/api/v1/auth/refresh", json={"refresh_token": invalid_token})
    assert response.status_code == 422
    assert "input" not in response.text
    assert not calls


def test_unknown_short_local_refresh_token_is_not_authenticated(client):
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": "aB3dE6gH9jK2"}).status_code == 401


def test_new_reset_request_invalidates_old_reset_token(client, user, settings):
    client.post("/api/v1/auth/password/request-reset", json={"email": user.email})
    path = settings.storage_dir.parent / "auth-outbox"
    first_file = next(path.glob("*.json"))
    old = json.loads(first_file.read_text())["token"]
    client.post("/api/v1/auth/password/request-reset", json={"email": user.email})
    new_file = next(file for file in path.glob("*.json") if file != first_file)
    new = json.loads(new_file.read_text())["token"]
    password = "Updated-reset-password-2026"
    assert client.post("/api/v1/auth/password/reset", json={"token": old, "password": password}).status_code == 400
    assert client.post("/api/v1/auth/password/reset", json={"token": new, "password": password}).status_code == 200


def test_local_capabilities_never_contact_an_external_provider(client, monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("Local email sign-in must not contact a provider")
    monkeypatch.setattr("httpx.request", unexpected)
    assert client.get("/api/v1/auth/capabilities").json()["providers"] == dict.fromkeys(
        ("google", "apple", "phone"), "disabled")
    assert client.get("/api/v1/auth/capabilities").json()["external_provider_configuration_required"] is False
