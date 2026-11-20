"""Credential primitives, origin guard, and rate limits. No HTTP routes here."""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from psycopg import AsyncConnection

# OWASP floor: Argon2id m=19 MiB, t=2, p=1.
_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
_dummy_hash: str | None = None

PASSWORD_MIN = 15  # NIST SP 800-63B-4, single-factor.
PASSWORD_MAX = 128
EMAIL_MAX = 254
SESSION_TTL = timedelta(days=30)
SESSION_IDLE = timedelta(days=7)
SESSION_TOUCH = timedelta(minutes=5)
VERIFY_TTL = timedelta(hours=24)
RESET_TTL = timedelta(minutes=30)

_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")

# Whole-value blocklist (NIST compares the entire secret). Small on purpose: online
# guessing is already throttled. ponytail: add a breached-password k-anonymity check
# when abuse shows up.
_BLOCKLIST = frozenset(
    {
        "passwordpassword",
        "password12345678",
        "123456789012345",
        "1234567890123456",
        "12345678901234567890",
        "qwertyuiopasdfgh",
        "qwertyuiopasdfghjkl",
        "qwertyuiop123456",
        "iloveyouiloveyou",
        "letmeinletmein1",
        "abcdefghijklmnop",
        "abcdefghijklmnopqrstuvwxyz",
        "correcthorsebatterystaple",
        "trustno1trustno1",
        "welcome123456789",
        "administrator123",
        "passwordpassword1",
        "password1234567",
        "000000000000000",
        "111111111111111",
        "tidyaitidyaitidyai",
        "tidyaipassword123",
    }
)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored: str | None, password: str) -> bool:
    """Constant-shape check. A missing hash still burns one Argon2 verify."""
    global _dummy_hash
    if not stored:
        if _dummy_hash is None:
            _dummy_hash = _hasher.hash(secrets.token_urlsafe(24))
        try:
            _hasher.verify(_dummy_hash, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            pass
        return False
    try:
        return _hasher.verify(stored, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored)
    except InvalidHashError:
        return True


def password_problem(password: str, email: str = "") -> str | None:
    """Return a user-facing reason, or None when the password is acceptable."""
    if len(password) < PASSWORD_MIN:
        return f"Use at least {PASSWORD_MIN} characters. A short phrase works well."
    if len(password) > PASSWORD_MAX:
        return f"Use at most {PASSWORD_MAX} characters."
    lowered = password.lower()
    if lowered in _BLOCKLIST:
        return "That password is too common. Try a phrase only you would pick."
    if len(set(lowered)) < 5:
        return "That password repeats too few characters. Try a phrase."
    local = email.split("@", 1)[0].lower() if email else ""
    for word in filter(None, {"tidyai", local, email.lower()}):
        if len(word) >= 4 and word in lowered and len(lowered.replace(word, "").strip()) < 8:
            return "Do not build the password from your email or the app name."
    return None


def normalize_email(raw: str) -> str | None:
    email = (raw or "").strip().lower()
    if not email or len(email) > EMAIL_MAX or not _EMAIL_RE.match(email):
        return None
    return email


def new_token() -> tuple[str, str]:
    """Return (secret for the client, digest for the database)."""
    token = secrets.token_urlsafe(32)
    return token, token_digest(token)


def token_digest(token: str) -> str:
    # Uniform random secret, so a fast hash is the right tool (not Argon2).
    return hashlib.sha256(token.encode()).hexdigest()


def safe_next(path: str | None, fallback: str = "/app") -> str:
    """Only same-app absolute paths. Blocks //evil, /\\evil, schemes, and control bytes."""
    if not path or not path.startswith("/") or path.startswith("//") or path.startswith("/\\"):
        return fallback
    if any(ord(ch) < 0x20 or ch == "\\" for ch in path):
        return fallback
    return path[:512]


CSRF_HEADER = "x-tidyai-csrf"
_UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


class OriginGuard:
    """Pure ASGI so SSE streams are untouched.

    Unsafe methods need the custom header (forces a CORS preflight for cross-site
    callers) and an allowed Origin, or Sec-Fetch-Site=same-origin when Origin is absent.
    """

    def __init__(self, app, allowed_origins: tuple[str, ...]):
        self.app = app
        self.allowed = {origin.rstrip("/") for origin in allowed_origins}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in _UNSAFE:
            await self.app(scope, receive, send)
            return
        headers = {key.decode("latin-1"): value.decode("latin-1") for key, value in scope["headers"]}
        if not self.allows(headers):
            await _reject(send)
            return
        await self.app(scope, receive, send)

    def allows(self, headers: dict[str, str]) -> bool:
        if headers.get(CSRF_HEADER) != "1":
            return False
        origin = headers.get("origin", "").rstrip("/")
        if origin:
            return origin in self.allowed
        return headers.get("sec-fetch-site") == "same-origin"


async def _reject(send) -> None:
    body = b'{"code":"bad_origin","message":"Request blocked. Reload the page and try again."}'
    await send(
        {
            "type": "http.response.start",
            "status": 403,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": body})


async def rate_limited(conn: AsyncConnection, bucket: str, limit: int, window: timedelta) -> bool:
    """Sliding-window count in Postgres so the limit holds across workers.

    Records this attempt, then reports whether the bucket is over its limit.
    ponytail: one row per attempt. Move to Redis or an edge limiter under real abuse.
    """
    await conn.execute("INSERT INTO rate_events (bucket) VALUES (%s)", (bucket,))
    row = await (
        await conn.execute(
            "SELECT count(*) AS n FROM rate_events WHERE bucket = %s AND at > now() - %s",
            (bucket, window),
        )
    ).fetchone()
    await conn.execute(
        "DELETE FROM rate_events WHERE bucket = %s AND at < now() - interval '1 day'",
        (bucket,),
    )
    return int(row["n"]) > limit
