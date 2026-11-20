"""Plain-text account mail over SMTP. Local mode without SMTP prints to the log.

Sends run in the background so a request takes the same time whether or not an
account exists (no enumeration by timing).
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage

from tidyai_api.config import settings

log = logging.getLogger("tidyai.mail")
_pending: set[asyncio.Task] = set()


def _send_sync(to: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    context = ssl.create_default_context()
    if settings.smtp_port == 465:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=context, timeout=15) as smtp:
            _login_and_send(smtp, message)
        return
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        if settings.smtp_starttls:
            smtp.starttls(context=context)
        _login_and_send(smtp, message)


def _login_and_send(smtp: smtplib.SMTP, message: EmailMessage) -> None:
    if settings.smtp_user:
        smtp.login(settings.smtp_user, settings.smtp_password)
    smtp.send_message(message)


async def _deliver(to: str, subject: str, body: str) -> None:
    if not settings.smtp_enabled:
        if settings.hosted:
            log.error("SMTP is not configured; dropped %r mail.", subject)
            return
        # Local dev sink. Contains the link on purpose so sign-up works without SMTP.
        log.warning("DEV MAIL to %s | %s\n%s", to, subject, body)
        return
    try:
        await asyncio.to_thread(_send_sync, to, subject, body)
    except (OSError, smtplib.SMTPException) as exc:
        log.error("Mail %r failed: %s", subject, type(exc).__name__)


def send(to: str, subject: str, body: str) -> None:
    task = asyncio.get_running_loop().create_task(_deliver(to, subject, body))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


def link(path: str, token: str) -> str:
    # Fragment, not query: never reaches server logs or the Referer header.
    return f"{settings.public_url}{path}#token={token}"


def verify_email(to: str, token: str) -> None:
    send(
        to,
        "Confirm your tidyai email",
        "Open this link to confirm your email and sign in. It expires in 24 hours.\n\n"
        f"{link('/verify', token)}\n\nIf you did not sign up, ignore this message.",
    )


def signup_exists(to: str) -> None:
    send(
        to,
        "Someone tried to sign up with your email",
        "An account with this email already exists. If that was you, sign in or reset your password:\n\n"
        f"{settings.public_url}/forgot\n\nIf it was not you, you can ignore this message.",
    )


def reset_password(to: str, token: str) -> None:
    send(
        to,
        "Reset your tidyai password",
        "Open this link to choose a new password. It expires in 30 minutes and works once.\n\n"
        f"{link('/reset', token)}\n\nIf you did not ask for this, ignore this message. Your password is unchanged.",
    )


def password_changed(to: str) -> None:
    send(
        to,
        "Your tidyai password changed",
        "Your password was just changed and other sessions were signed out.\n\n"
        f"If this was not you, reset it now: {settings.public_url}/forgot",
    )
