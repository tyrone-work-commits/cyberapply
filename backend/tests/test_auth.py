import json

import httpx
import jwt

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


def test_local_phone_oauth_are_explicitly_unconfigured(client):
    assert client.get("/api/v1/auth/capabilities").json()["phone"] is False
    assert client.post("/api/v1/auth/phone/request-code", json={"phone": "+2348000000000"}).status_code == 503
    assert client.post("/api/v1/auth/oauth/google/start", json={
        "redirect_url": "http://localhost:3000/auth/callback", "code_challenge": "A" * 43}).status_code == 503


def test_supabase_oauth_pkce_redirect_validation_and_exchange(client, settings, monkeypatch):
    settings.auth_mode = "supabase"
    settings.supabase_url = "https://project.example.com"
    settings.supabase_anon_key = "public-key"
    payload = {"redirect_url": "https://attacker.example/callback", "code_challenge": "A" * 43}
    assert client.post("/api/v1/auth/oauth/google/start", json=payload).status_code == 400
    payload["redirect_url"] = "http://localhost:3000/auth/callback"
    response = client.post("/api/v1/auth/oauth/google/start", json=payload)
    assert "code_challenge_method=s256" in response.json()["authorization_url"]
    requests = []
    def fake(method, url, **kwargs):
        requests.append((method, url, kwargs))
        return httpx.Response(200, json={"access_token": "provider-issued-token"}, request=httpx.Request(method, url))
    monkeypatch.setattr("app.domain.auth.httpx.request", fake)
    assert client.post("/api/v1/auth/oauth/exchange", json={"code": "provider-code-123", "code_verifier": "B" * 43}).status_code == 200
    assert requests[0][2]["json"] == {"auth_code": "provider-code-123", "code_verifier": "B" * 43}


def test_supabase_verified_identity_creates_user(client, settings, monkeypatch):
    from uuid import uuid4
    settings.auth_mode = "supabase"
    settings.supabase_url = "https://project.example.com"
    settings.supabase_jwt_secret = "supabase-test-signing-secret-32-characters"
    identifier = str(uuid4())
    token = jwt.encode({"sub": identifier, "email": "provider@example.com", "aud": "authenticated",
                        "role": "authenticated", "iss": settings.supabase_url + "/auth/v1",
                        "iat": utcnow(), "exp": 9999999999}, settings.supabase_jwt_secret, algorithm="HS256")
    monkeypatch.setattr("httpx.get", lambda *a, **k: httpx.Response(200, json={"id": identifier, "email": "provider@example.com", "email_confirmed_at": "2026-10-11T00:00:00Z"}))
    response = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + token})
    assert response.status_code == 200, response.text
    assert response.json()["id"] == identifier
    assert response.json()["email_verified"] is True


def test_provider_logout_revokes_still_valid_access_token(client, settings, user, monkeypatch):
    settings.auth_mode = "supabase"
    settings.supabase_url = "https://project.example.com"
    settings.supabase_jwt_secret = "supabase-test-signing-secret-32-characters"
    token = jwt.encode({"sub": user.id, "email": user.email, "aud": "authenticated", "role": "authenticated",
                        "iss": settings.supabase_url + "/auth/v1", "iat": utcnow(), "exp": 9999999999},
                       settings.supabase_jwt_secret, algorithm="HS256")
    headers = {"Authorization": "Bearer " + token}
    monkeypatch.setattr("app.domain.auth.provider_call", lambda *a, **k: {})
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


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


def test_malformed_jwt_algorithm_returns_401(client, settings):
    import base64
    settings.auth_mode = "supabase"
    settings.supabase_url = "https://project.example.com"
    settings.supabase_jwt_secret = "test-supabase-secret-with-32-characters"
    for algorithm in [[], {}, 42, None]:
        head = base64.urlsafe_b64encode(json.dumps({"alg": algorithm}).encode()).rstrip(b"=").decode()
        payload = base64.urlsafe_b64encode(b'{"sub":"attacker"}').rstrip(b"=").decode()
        token = head + "." + payload + ".AAAA"
        assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401


def test_provider_token_issue_time_is_a_valid_integer(client, settings, user):
    settings.auth_mode = "supabase"
    settings.supabase_url = "https://project.example.com"
    settings.supabase_jwt_secret = "test-supabase-secret-with-32-characters"
    for issued in ["1", True, 1.5, [], {}]:
        token = jwt.encode({"sub": user.id, "email": user.email, "aud": "authenticated",
                            "role": "authenticated", "iss": settings.supabase_url + "/auth/v1",
                            "iat": issued, "exp": 9999999999}, settings.supabase_jwt_secret, algorithm="HS256")
        assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401
