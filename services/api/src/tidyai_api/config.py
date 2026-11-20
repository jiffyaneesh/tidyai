"""Process settings, read once from env. Secrets never get a default in hosted mode."""

from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass, field

log = logging.getLogger("tidyai.config")


def _list(raw: str) -> tuple[str, ...]:
    return tuple(item.strip().rstrip("/") for item in raw.split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    egress: str
    public_url: str
    app_origins: tuple[str, ...]
    session_secret: str
    google_client_id: str
    google_client_secret: str
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str = field(repr=False)
    smtp_from: str
    smtp_starttls: bool

    @property
    def hosted(self) -> bool:
        return self.egress == "hosted"

    @property
    def cookie_secure(self) -> bool:
        return self.hosted or self.public_url.startswith("https://")

    @property
    def session_cookie(self) -> str:
        # __Host- needs Secure, Path=/ and no Domain. Plain http dev cannot set it.
        return "__Host-tidyai_session" if self.cookie_secure else "tidyai_session"

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)


def load_settings() -> Settings:
    egress = os.environ.get("TIDYAI_EGRESS", "local").strip().lower()
    if egress not in {"local", "hosted"}:
        raise RuntimeError("TIDYAI_EGRESS must be local or hosted.")
    public_url = os.environ.get("TIDYAI_PUBLIC_URL", "http://127.0.0.1:5173").strip().rstrip("/")
    origins = _list(os.environ.get("TIDYAI_APP_ORIGINS", "")) or (
        public_url,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )
    secret = os.environ.get("TIDYAI_SESSION_SECRET", "").strip()
    if egress == "hosted":
        if len(secret) < 32:
            raise RuntimeError("TIDYAI_SESSION_SECRET must be at least 32 characters in hosted mode.")
        if not public_url.startswith("https://"):
            raise RuntimeError("TIDYAI_PUBLIC_URL must be https in hosted mode.")
        origins = tuple(origin for origin in origins if origin.startswith("https://"))
    if not secret:
        secret = secrets.token_urlsafe(48)
        log.warning("TIDYAI_SESSION_SECRET unset; using a per-process secret. Google sign-in state resets on restart.")
    return Settings(
        egress=egress,
        public_url=public_url,
        app_origins=origins,
        session_secret=secret,
        google_client_id=os.environ.get("GOOGLE_CLIENT_ID", "").strip(),
        google_client_secret=os.environ.get("GOOGLE_CLIENT_SECRET", "").strip(),
        smtp_host=os.environ.get("SMTP_HOST", "").strip(),
        smtp_port=int(os.environ.get("SMTP_PORT", "587") or 587),
        smtp_user=os.environ.get("SMTP_USER", "").strip(),
        smtp_password=os.environ.get("SMTP_PASSWORD", ""),
        smtp_from=os.environ.get("SMTP_FROM", "").strip(),
        smtp_starttls=os.environ.get("SMTP_STARTTLS", "1").strip() != "0",
    )


settings = load_settings()
