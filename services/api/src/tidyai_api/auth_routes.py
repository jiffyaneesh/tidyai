"""HTTP for sign-up, sign-in, Google, sessions, and the signed-in account.

Errors stay generic where detail would reveal whether an account exists.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from psycopg import AsyncConnection, OperationalError
from pydantic import BaseModel, Field

from tidyai_api import auth_store as store
from tidyai_api import db, mailer
from tidyai_api.config import settings
from tidyai_api.security import (
    PASSWORD_MAX,
    PASSWORD_MIN,
    RESET_TTL,
    SESSION_TTL,
    VERIFY_TTL,
    hash_password,
    needs_rehash,
    normalize_email,
    password_problem,
    rate_limited,
    safe_next,
    token_digest,
    verify_password,
)

log = logging.getLogger("tidyai.auth")
router = APIRouter()

oauth = OAuth()
if settings.google_enabled:
    oauth.register(
        "google",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile", "code_challenge_method": "S256"},
    )

GOOGLE_CALLBACK = f"{settings.public_url}/api/v1/auth/google/callback"
WINDOW_15M = timedelta(minutes=15)
WINDOW_1H = timedelta(hours=1)


class AuthError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"code": code, "message": message}, status_code=status, headers={"Cache-Control": "no-store"})


BAD_LOGIN = (401, "bad_credentials", "Email or password is incorrect.")
TOO_MANY = (429, "rate_limited", "Too many attempts. Wait a few minutes and try again.")
UNAUTHENTICATED = (401, "unauthenticated", "Sign in to continue.")
ACCEPTED = {"ok": True}


class SignupIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=PASSWORD_MAX * 4)
    displayName: str = Field(default="", max_length=80)


class LoginIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=PASSWORD_MAX * 4)


class EmailIn(BaseModel):
    email: str = Field(max_length=320)


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=128)


class ResetIn(TokenIn):
    password: str = Field(max_length=PASSWORD_MAX * 4)


class ProfileIn(BaseModel):
    displayName: str = Field(min_length=0, max_length=80)


class PasswordChangeIn(BaseModel):
    currentPassword: str = Field(default="", max_length=PASSWORD_MAX * 4)
    newPassword: str = Field(max_length=PASSWORD_MAX * 4)


class DeleteAccountIn(BaseModel):
    confirmEmail: str = Field(max_length=320)
    password: str = Field(default="", max_length=PASSWORD_MAX * 4)


def client_ip(request: Request) -> str:
    # Behind a proxy, run uvicorn with --proxy-headers and --forwarded-allow-ips so this is the real client.
    return request.client.host if request.client else "unknown"


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.session_cookie,
        token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(settings.session_cookie, path="/", secure=settings.cookie_secure, httponly=True, samesite="lax")


async def user_out(conn: AsyncConnection, user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "emailVerified": user["email_verified_at"] is not None,
        "displayName": user["display_name"],
        "hasPassword": bool(user["password_hash"]),
        "providers": await store.linked_providers(conn, user["id"]),
        "createdAt": user["created_at"].isoformat(),
    }


async def _start_session(conn: AsyncConnection, request: Request, user_id: str) -> str:
    return await store.create_session(conn, user_id, request.headers.get("user-agent", ""), client_ip(request))


class SessionContext:
    def __init__(self, user: dict, digest: str):
        self.user = user
        self.digest = digest

    @property
    def id(self) -> str:
        return self.user["id"]


async def session_context(request: Request) -> SessionContext:
    token = request.cookies.get(settings.session_cookie, "")
    if not token:
        raise AuthError(*UNAUTHENTICATED)
    try:
        async with await db.connect() as conn:
            found = await store.session_user(conn, token)
            await conn.commit()
    except OperationalError:
        raise AuthError(503, "db_down", "Database is not running.") from None
    if found is None:
        raise AuthError(*UNAUTHENTICATED)
    return SessionContext(*found)


async def current_user(ctx: SessionContext = Depends(session_context)) -> str:
    """Dependency for domain routes: the signed-in user id."""
    return ctx.id


@router.get("/v1/auth/config")
async def auth_config():
    return {"googleEnabled": settings.google_enabled, "passwordMin": PASSWORD_MIN, "passwordMax": PASSWORD_MAX}


@router.post("/v1/auth/signup", status_code=202)
async def signup(body: SignupIn, request: Request):
    email = normalize_email(body.email)
    if email is None:
        return error(422, "bad_email", "Enter a valid email address.")
    problem = password_problem(body.password, email)
    if problem:
        return error(422, "weak_password", problem)
    # Hash before the lookup so both branches cost the same.
    password_hash = hash_password(body.password)
    async with await db.connect() as conn:
        async with conn.transaction():
            if await rate_limited(conn, f"signup:ip:{client_ip(request)}", 10, WINDOW_1H):
                return error(*TOO_MANY)
            if await rate_limited(conn, f"signup:email:{email}", 3, WINDOW_1H):
                return ACCEPTED
            existing = await store.user_by_email(conn, email)
            if existing is not None:
                mailer.signup_exists(email)
                return ACCEPTED
            user = await store.create_user(conn, email, password_hash, body.displayName.strip(), verified=False)
            token = await store.issue_token(conn, user["id"], "verify_email", VERIFY_TTL)
    mailer.verify_email(email, token)
    return ACCEPTED


@router.post("/v1/auth/verify")
async def verify(body: TokenIn, request: Request):
    async with await db.connect() as conn:
        async with conn.transaction():
            if await rate_limited(conn, f"verify:ip:{client_ip(request)}", 30, WINDOW_15M):
                return error(*TOO_MANY)
            user_id = await store.consume_token(conn, body.token, "verify_email")
            if user_id is None:
                return error(400, "bad_token", "This link is invalid or expired. Request a new one.")
            await store.mark_verified(conn, user_id)
            await store.claim_legacy_projects(conn, user_id)
            token = await _start_session(conn, request, user_id)
            user = await store.user_by_id(conn, user_id)
            out = await user_out(conn, user)
    response = JSONResponse(out, headers={"Cache-Control": "no-store"})
    set_session_cookie(response, token)
    return response


@router.post("/v1/auth/resend-verification", status_code=202)
async def resend_verification(body: EmailIn, request: Request):
    email = normalize_email(body.email)
    if email is None:
        return ACCEPTED
    async with await db.connect() as conn:
        async with conn.transaction():
            if await rate_limited(conn, f"resend:ip:{client_ip(request)}", 10, WINDOW_1H):
                return error(*TOO_MANY)
            if await rate_limited(conn, f"resend:email:{email}", 3, WINDOW_1H):
                return ACCEPTED
            user = await store.user_by_email(conn, email)
            if user is None or user["email_verified_at"] is not None:
                return ACCEPTED
            token = await store.issue_token(conn, user["id"], "verify_email", VERIFY_TTL)
    mailer.verify_email(email, token)
    return ACCEPTED


@router.post("/v1/auth/login")
async def login(body: LoginIn, request: Request):
    email = normalize_email(body.email) or ""
    async with await db.connect() as conn:
        async with conn.transaction():
            limited_ip = await rate_limited(conn, f"login:ip:{client_ip(request)}", 30, WINDOW_15M)
            limited_email = bool(email) and await rate_limited(conn, f"login:email:{email}", 10, WINDOW_15M)
        if limited_ip or limited_email:
            return error(*TOO_MANY)
        user = await store.user_by_email(conn, email) if email else None
        if not verify_password(user["password_hash"] if user else None, body.password):
            return error(*BAD_LOGIN)
        if user["email_verified_at"] is None:
            return error(403, "email_unverified", "Confirm your email first. We can send a new link.")
        async with conn.transaction():
            if needs_rehash(user["password_hash"]):
                await store.set_password(conn, user["id"], hash_password(body.password))
            token = await _start_session(conn, request, user["id"])
            out = await user_out(conn, user)
    response = JSONResponse(out, headers={"Cache-Control": "no-store"})
    set_session_cookie(response, token)
    return response


@router.post("/v1/auth/logout", status_code=204)
async def logout(request: Request):
    token = request.cookies.get(settings.session_cookie, "")
    response = Response(status_code=204)
    clear_session_cookie(response)
    if token:
        try:
            async with await db.connect() as conn:
                await store.delete_session(conn, token_digest(token))
                await conn.commit()
        except OperationalError:
            pass
    return response


@router.post("/v1/auth/forgot", status_code=202)
async def forgot(body: EmailIn, request: Request):
    email = normalize_email(body.email)
    if email is None:
        return ACCEPTED
    async with await db.connect() as conn:
        async with conn.transaction():
            if await rate_limited(conn, f"forgot:ip:{client_ip(request)}", 10, WINDOW_1H):
                return error(*TOO_MANY)
            if await rate_limited(conn, f"forgot:email:{email}", 3, WINDOW_1H):
                return ACCEPTED
            user = await store.user_by_email(conn, email)
            if user is None:
                return ACCEPTED
            token = await store.issue_token(conn, user["id"], "reset_password", RESET_TTL)
    mailer.reset_password(email, token)
    return ACCEPTED


@router.post("/v1/auth/reset", status_code=204)
async def reset(body: ResetIn, request: Request):
    async with await db.connect() as conn:
        async with conn.transaction():
            if await rate_limited(conn, f"reset:ip:{client_ip(request)}", 20, WINDOW_15M):
                return error(*TOO_MANY)
            user_id = await store.peek_token(conn, body.token, "reset_password")
            user = await store.user_by_id(conn, user_id) if user_id else None
        if user is None:
            return error(400, "bad_token", "This link is invalid or expired. Request a new one.")
        problem = password_problem(body.password, user["email"])
        if problem:
            return error(422, "weak_password", problem)
        password_hash = hash_password(body.password)
        async with conn.transaction():
            if await store.consume_token(conn, body.token, "reset_password") != user["id"]:
                return error(400, "bad_token", "This link is invalid or expired. Request a new one.")
            await store.set_password(conn, user["id"], password_hash)
            await store.mark_verified(conn, user["id"])
            await store.delete_sessions(conn, user["id"])
    mailer.password_changed(user["email"])
    return Response(status_code=204)


@router.get("/v1/auth/google/start")
async def google_start(request: Request, next: str = "/app"):
    if not settings.google_enabled:
        return RedirectResponse(f"{settings.public_url}/login?error=google_disabled", status_code=303)
    request.session["auth_next"] = safe_next(next)
    return await oauth.google.authorize_redirect(request, GOOGLE_CALLBACK)


def _claim_true(value) -> bool:
    return value is True or (isinstance(value, str) and value.lower() == "true")


async def google_user(conn: AsyncConnection, subject: str, email: str, name: str) -> str:
    """Resolve a verified Google identity to a user id. Caller owns the transaction."""
    user = await store.oauth_user(conn, "google", subject)
    if user is None:
        user = await store.user_by_email(conn, email)
        if user is not None and user["email_verified_at"] is None:
            # Pre-account hijack guard: whoever set this password never proved the inbox.
            # Google just did. Drop their credential and sessions before linking.
            await store.set_password(conn, user["id"], None)
            await store.delete_sessions(conn, user["id"])
            log.warning("Google sign-in replaced an unverified password on %s.", user["id"])
        if user is None:
            user = await store.create_user(conn, email, None, name, verified=True)
        await store.mark_verified(conn, user["id"])
        await store.link_oauth(conn, "google", subject, user["id"], email)
    await store.claim_legacy_projects(conn, user["id"])
    return user["id"]


@router.get("/v1/auth/google/callback")
async def google_callback(request: Request):
    fail = RedirectResponse(f"{settings.public_url}/login?error=google", status_code=303)
    if not settings.google_enabled:
        return fail
    next_path = safe_next(request.session.pop("auth_next", None))
    try:
        token = await oauth.google.authorize_access_token(request)
    except OAuthError as exc:
        log.warning("Google sign-in failed: %s", exc.error)
        return fail
    info = token.get("userinfo") or {}
    subject = str(info.get("sub") or "")
    email = normalize_email(str(info.get("email") or ""))
    if not subject or email is None or not _claim_true(info.get("email_verified")):
        log.warning("Google sign-in rejected: missing sub or unverified email.")
        return RedirectResponse(f"{settings.public_url}/login?error=google_unverified", status_code=303)
    name = str(info.get("name") or "")[:80]
    try:
        async with await db.connect() as conn:
            async with conn.transaction():
                user_id = await google_user(conn, subject, email, name)
                session_token = await _start_session(conn, request, user_id)
    except OperationalError:
        return fail
    response = RedirectResponse(f"{settings.public_url}{next_path}", status_code=303)
    set_session_cookie(response, session_token)
    return response


@router.get("/v1/me")
async def me(ctx: SessionContext = Depends(session_context)):
    async with await db.connect() as conn:
        return JSONResponse(await user_out(conn, ctx.user), headers={"Cache-Control": "no-store"})


@router.patch("/v1/me")
async def update_me(body: ProfileIn, ctx: SessionContext = Depends(session_context)):
    name = " ".join(body.displayName.split())
    async with await db.connect() as conn:
        async with conn.transaction():
            await store.set_display_name(conn, ctx.id, name)
            user = await store.user_by_id(conn, ctx.id)
            return await user_out(conn, user)


@router.post("/v1/me/password", status_code=204)
async def change_password(body: PasswordChangeIn, request: Request, ctx: SessionContext = Depends(session_context)):
    async with await db.connect() as conn:
        async with conn.transaction():
            if await rate_limited(conn, f"pwchange:user:{ctx.id}", 10, WINDOW_15M):
                return error(*TOO_MANY)
        if ctx.user["password_hash"] and not verify_password(ctx.user["password_hash"], body.currentPassword):
            return error(403, "bad_password", "Current password is incorrect.")
        problem = password_problem(body.newPassword, ctx.user["email"])
        if problem:
            return error(422, "weak_password", problem)
        password_hash = hash_password(body.newPassword)
        async with conn.transaction():
            await store.set_password(conn, ctx.id, password_hash)
            await store.delete_sessions(conn, ctx.id, keep_digest=ctx.digest)
    mailer.password_changed(ctx.user["email"])
    return Response(status_code=204)


@router.get("/v1/me/sessions")
async def my_sessions(ctx: SessionContext = Depends(session_context)):
    async with await db.connect() as conn:
        rows = await store.list_sessions(conn, ctx.id)
    return [
        {
            "id": store.session_public_id(row["token_hash"]),
            "current": row["token_hash"] == ctx.digest,
            "createdAt": row["created_at"].isoformat(),
            "lastSeenAt": row["last_seen_at"].isoformat(),
            "userAgent": row["user_agent"],
            "ip": row["ip"],
        }
        for row in rows
    ]


@router.delete("/v1/me/sessions/{public_id}", status_code=204)
async def revoke_session(public_id: str, ctx: SessionContext = Depends(session_context)):
    if public_id == store.session_public_id(ctx.digest):
        return error(400, "current_session", "Use sign out to end this session.")
    async with await db.connect() as conn:
        removed = await store.delete_session_by_public_id(conn, ctx.id, public_id)
        await conn.commit()
    if not removed:
        return error(404, "not_found", "Session not found.")
    return Response(status_code=204)


@router.post("/v1/me/sessions/revoke-others")
async def revoke_other_sessions(ctx: SessionContext = Depends(session_context)):
    async with await db.connect() as conn:
        removed = await store.delete_sessions(conn, ctx.id, keep_digest=ctx.digest)
        await conn.commit()
    return {"revoked": removed}


@router.delete("/v1/me", status_code=204)
async def delete_me(body: DeleteAccountIn, ctx: SessionContext = Depends(session_context)):
    if normalize_email(body.confirmEmail) != ctx.user["email"]:
        return error(400, "confirm_mismatch", "Type your account email exactly to confirm.")
    if ctx.user["password_hash"]:
        if not verify_password(ctx.user["password_hash"], body.password):
            return error(403, "bad_password", "Password is incorrect.")
    else:
        async with await db.connect() as conn:
            row = await (
                await conn.execute("SELECT created_at FROM sessions WHERE token_hash = %s", (ctx.digest,))
            ).fetchone()
        if row is None or row["created_at"] < datetime.now(timezone.utc) - timedelta(minutes=15):
            return error(403, "reauth_required", "Sign in again with Google, then delete within 15 minutes.")
    async with await db.connect() as conn:
        await store.delete_user(conn, ctx.id)
        await conn.commit()
    log.warning("Account %s deleted by its owner.", ctx.id)
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response
