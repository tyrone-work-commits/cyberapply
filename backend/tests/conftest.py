import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import db as db_module
from app.core.config import Settings, get_settings
from app.core.db import Base, get_db
from app.core.security import ensure_user_records, issue_access, password_hash
from app.models import User


@pytest.fixture
def settings(tmp_path, monkeypatch):
    config = Settings(environment="test", database_url="sqlite:///:memory:", storage_dir=tmp_path / "documents",
                      jwt_secret="test-private-jwt-signing-key-unique-32-chars", auth_rate_limit=100,
                      _env_file=None)
    get_settings.cache_clear()
    monkeypatch.setattr("app.core.config.get_settings", lambda: config)
    # Modules import get_settings; replace bindings without changing real configurations.
    import sys
    for name, module in list(sys.modules.items()):
        if name.startswith("app.") and hasattr(module, "get_settings"):
            monkeypatch.setattr(module, "get_settings", lambda: config)
    return config


@pytest.fixture
def engine(settings, monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(db_module, "engine", engine)
    monkeypatch.setattr(db_module, "SessionLocal", factory)
    # Worker imports may have bound the factory before this fixture runs.
    import sys
    for name, module in list(sys.modules.items()):
        if name.startswith("app.") and hasattr(module, "SessionLocal"):
            monkeypatch.setattr(module, "SessionLocal", factory)
    yield engine
    engine.dispose()


@pytest.fixture
def db(engine):
    with sessionmaker(bind=engine, expire_on_commit=False)() as session:
        yield session


@pytest.fixture
def client(engine, settings):
    from app.main import create_app
    app = create_app()
    def session_override():
        with sessionmaker(bind=engine, expire_on_commit=False)() as session:
            yield session
    app.dependency_overrides[get_db] = session_override
    with TestClient(app) as client:
        yield client


def make_user(db, email):
    user = User(email=email, password_hash=password_hash.hash("Strong-test-password-2026"), email_verified=True)
    db.add(user)
    ensure_user_records(db, user)
    db.commit()
    return user


@pytest.fixture
def user(db):
    return make_user(db, "owner@example.com")


@pytest.fixture
def other_user(db):
    return make_user(db, "other@example.com")


@pytest.fixture
def headers(user):
    return {"Authorization": "Bearer " + issue_access(user)}


@pytest.fixture
def other_headers(other_user):
    return {"Authorization": "Bearer " + issue_access(other_user)}
