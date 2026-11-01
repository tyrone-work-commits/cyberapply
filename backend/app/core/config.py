from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    environment: Literal["local", "test", "production"] = "local"
    database_url: str = f"sqlite:///{(ROOT / 'data' / 'cyberapply.db').as_posix()}"
    jwt_secret: str = "local-development-only-change-before-deployment-32chars"
    jwt_issuer: str = "cyberapply"
    access_token_minutes: int = Field(30, ge=1, le=1440)
    refresh_token_days: int = Field(7, ge=1, le=90)
    encryption_key: str = ""
    storage_backend: Literal["local"] = "local"
    storage_dir: Path = ROOT / "data" / "documents"
    max_upload_bytes: int = Field(10 * 1024 * 1024, ge=1024, le=50 * 1024 * 1024)
    upload_allowed_types: list[str] = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
    ]
    auth_mode: Literal["local"] = "local"
    frontend_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    redis_url: str = "redis://localhost:6379/0"
    worker_backend: Literal["database", "celery"] = "database"
    allow_external_submissions: bool = False
    webhook_connector_url: str = ""
    webhook_connector_secret: str = ""
    connector_allowed_hosts: list[str] = []
    worker_lease_seconds: int = Field(300, ge=30, le=3600)
    max_application_attempts: int = Field(3, ge=1, le=10)
    browser_connector_config: dict = {}
    browser_timeout_seconds: int = Field(30, ge=5, le=120)
    browser_channel: Literal["chromium", "chrome", "msedge"] = "chromium"
    mail_mode: Literal["demo", "smtp"] = "demo"
    mail_allowed_hosts: list[str] = [
        "imap.gmail.com",
        "smtp.gmail.com",
        "outlook.office365.com",
        "smtp.office365.com",
        "imap.mail.yahoo.com",
        "smtp.mail.yahoo.com",
    ]
    mail_timeout_seconds: int = Field(15, ge=1, le=60)
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    auth_email_mode: Literal["capture", "smtp"] = "capture"
    request_max_bytes: int = 12 * 1024 * 1024
    auth_rate_limit: int = Field(20, ge=1, le=100)

    @model_validator(mode="after")
    def production_guard(self):
        if self.environment == "production":
            raise ValueError(
                "The standalone prototype supports local/test use only. Use the internal ChatGPT Site for production."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
