"""SQL for users, sessions, one-time tokens, and linked identities.

Every function takes the caller's connection so a route can compose one transaction.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from psycopg import AsyncConnection

from tidyai_api.security import SESSION_IDLE, SESSION_TOUCH, SESSION_TTL, new_token, token_digest

log = logging.getLogger("tidyai.auth")

_USER_COLS = "id, email, email_verified_at, password_hash, display_name, created_at"


async def user_by_email(conn: AsyncConnection, email: str) -> dict | None:
    cur = await conn.execute(f"SELECT {_USER_COLS} FROM users WHERE email = %s", (email,))
    return await cur.fetchone()


async def user_by_id(conn: AsyncConnection, user_id: str) -> dict | None:
    cur = await conn.execute(f"SELECT {_USER_COLS} FROM users WHERE id = %s", (user_id,))
    return await cur.fetchone()


async def create_user(
    conn: AsyncConnection,
    email: str,
    password_hash: str | None,
    display_name: str,
    verified: bool,
) -> dict:
    user_id = str(uuid4())
    cur = await conn.execute(
        f"""
        INSERT INTO users (id, email, password_hash, display_name, email_verified_at)
        VALUES (%s, %s, %s, %s, CASE WHEN %s THEN now() END)
        RETURNING {_USER_COLS}
        """,
        (user_id, email, password_hash, display_name, verified),
    )
    return await cur.fetchone()


async def mark_verified(conn: AsyncConnection, user_id: str) -> None:
    await conn.execute(
        "UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = %s",
        (user_id,),
    )


async def set_password(conn: AsyncConnection, user_id: str, password_hash: str | None) -> None:
    await conn.execute(
        "UPDATE users SET password_hash = %s, updated_at = now() WHERE id = %s",
        (password_hash, user_id),
    )


async def set_display_name(conn: AsyncConnection, user_id: str, name: str) -> None:
    await conn.execute(
        "UPDATE users SET display_name = %s, updated_at = now() WHERE id = %s",
        (name, user_id),
    )


async def delete_user(conn: AsyncConnection, user_id: str) -> None:
    await conn.execute("DELETE FROM users WHERE id = %s", (user_id,))


async def claim_legacy_projects(conn: AsyncConnection, user_id: str) -> int:
    """Give pre-accounts projects to the first verified account. Runs once in practice.

    The advisory lock serialises concurrent verifications so two accounts cannot both
    believe they are first.
    """
    await conn.execute("SELECT pg_advisory_xact_lock(hashtext('tidyai_claim_legacy'))")
    other = await (
        await conn.execute(
            "SELECT 1 FROM users WHERE id <> %s AND email_verified_at IS NOT NULL LIMIT 1",
            (user_id,),
        )
    ).fetchone()
    if other is not None:
        return 0
    cur = await conn.execute("UPDATE projects SET owner_id = %s WHERE owner_id IS NULL", (user_id,))
    claimed = cur.rowcount or 0
    if claimed:
        log.warning("Assigned %s ownerless project(s) to the first verified account %s.", claimed, user_id)
    return claimed


async def create_session(conn: AsyncConnection, user_id: str, user_agent: str, ip: str) -> str:
    token, digest = new_token()
    await conn.execute(
        """
        INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip)
        VALUES (%s, %s, now() + %s, %s, %s)
        """,
        (digest, user_id, SESSION_TTL, user_agent[:300], ip[:64]),
    )
    return token


async def session_user(conn: AsyncConnection, token: str) -> tuple[dict, str] | None:
    """Return (user, token_hash) for a live session, enforcing absolute and idle expiry."""
    if not token or len(token) > 128:
        return None
    digest = token_digest(token)
    row = await (
        await conn.execute(
            """
            SELECT s.last_seen_at, s.expires_at,
                   u.id, u.email, u.email_verified_at, u.password_hash, u.display_name, u.created_at
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = %s
            """,
            (digest,),
        )
    ).fetchone()
    if row is None:
        return None
    now = datetime.now(timezone.utc)
    if row["expires_at"] <= now or row["last_seen_at"] + SESSION_IDLE <= now:
        await conn.execute("DELETE FROM sessions WHERE token_hash = %s", (digest,))
        return None
    if row["last_seen_at"] + SESSION_TOUCH <= now:
        await conn.execute("UPDATE sessions SET last_seen_at = now() WHERE token_hash = %s", (digest,))
    user = {key: row[key] for key in ("id", "email", "email_verified_at", "password_hash", "display_name", "created_at")}
    return user, digest


async def delete_session(conn: AsyncConnection, digest: str) -> None:
    await conn.execute("DELETE FROM sessions WHERE token_hash = %s", (digest,))


async def delete_sessions(conn: AsyncConnection, user_id: str, keep_digest: str | None = None) -> int:
    cur = await conn.execute(
        "DELETE FROM sessions WHERE user_id = %s AND token_hash IS DISTINCT FROM %s",
        (user_id, keep_digest),
    )
    return cur.rowcount or 0


def session_public_id(digest: str) -> str:
    # A prefix of the digest is enough to address a row and reveals nothing usable.
    return digest[:16]


async def list_sessions(conn: AsyncConnection, user_id: str) -> list[dict]:
    cur = await conn.execute(
        """
        SELECT token_hash, created_at, last_seen_at, user_agent, ip
        FROM sessions WHERE user_id = %s AND expires_at > now()
        ORDER BY last_seen_at DESC
        """,
        (user_id,),
    )
    return await cur.fetchall()


async def delete_session_by_public_id(conn: AsyncConnection, user_id: str, public_id: str) -> int:
    if len(public_id) != 16 or not all(ch in "0123456789abcdef" for ch in public_id):
        return 0
    cur = await conn.execute(
        "DELETE FROM sessions WHERE user_id = %s AND left(token_hash, 16) = %s",
        (user_id, public_id),
    )
    return cur.rowcount or 0


async def issue_token(conn: AsyncConnection, user_id: str, purpose: str, ttl: timedelta) -> str:
    """New single-use token. Earlier unused tokens for the same purpose stop working."""
    await conn.execute(
        "UPDATE auth_tokens SET used_at = now() WHERE user_id = %s AND purpose = %s AND used_at IS NULL",
        (user_id, purpose),
    )
    token, digest = new_token()
    await conn.execute(
        """
        INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at)
        VALUES (%s, %s, %s, now() + %s)
        """,
        (digest, user_id, purpose, ttl),
    )
    return token


async def peek_token(conn: AsyncConnection, token: str, purpose: str) -> str | None:
    if not token or len(token) > 128:
        return None
    row = await (
        await conn.execute(
            """
            SELECT user_id FROM auth_tokens
            WHERE token_hash = %s AND purpose = %s AND used_at IS NULL AND expires_at > now()
            """,
            (token_digest(token), purpose),
        )
    ).fetchone()
    return row["user_id"] if row else None


async def consume_token(conn: AsyncConnection, token: str, purpose: str) -> str | None:
    """Atomically mark used. Returns the user id, or None if invalid, expired, or reused."""
    if not token or len(token) > 128:
        return None
    row = await (
        await conn.execute(
            """
            UPDATE auth_tokens SET used_at = now()
            WHERE token_hash = %s AND purpose = %s AND used_at IS NULL AND expires_at > now()
            RETURNING user_id
            """,
            (token_digest(token), purpose),
        )
    ).fetchone()
    return row["user_id"] if row else None


async def oauth_user(conn: AsyncConnection, provider: str, subject: str) -> dict | None:
    row = await (
        await conn.execute(
            "SELECT user_id FROM oauth_accounts WHERE provider = %s AND subject = %s",
            (provider, subject),
        )
    ).fetchone()
    return await user_by_id(conn, row["user_id"]) if row else None


async def link_oauth(conn: AsyncConnection, provider: str, subject: str, user_id: str, email: str) -> None:
    await conn.execute(
        """
        INSERT INTO oauth_accounts (provider, subject, user_id, email)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (provider, subject) DO NOTHING
        """,
        (provider, subject, user_id, email),
    )


async def linked_providers(conn: AsyncConnection, user_id: str) -> list[str]:
    cur = await conn.execute(
        "SELECT provider FROM oauth_accounts WHERE user_id = %s ORDER BY provider",
        (user_id,),
    )
    return [row["provider"] for row in await cur.fetchall()]
