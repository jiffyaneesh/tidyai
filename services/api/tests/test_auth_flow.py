"""Sign-up, verify, sign-in, reset, sessions, and the origin guard. Needs Postgres."""

from __future__ import annotations

import asyncio
import unittest
from uuid import uuid4

from tests import testdb  # noqa: F401  isort: skip
from fastapi.testclient import TestClient

from tidyai_api import auth_routes, db, mailer
from tidyai_api import auth_store as store
from tidyai_api.main import app

ORIGIN = "http://127.0.0.1:5173"
HEADERS = {"Origin": ORIGIN, "X-Tidyai-Csrf": "1"}
GOOD = "violet kettles hum at dawn"


def run(coro):
    return asyncio.run(coro)


class Mailbox:
    def __init__(self):
        self.sent: list[tuple[str, str, str]] = []

    def install(self):
        for name in ("verify_email", "reset_password"):
            setattr(mailer, name, self._capture(name))
        for name in ("signup_exists", "password_changed"):
            setattr(mailer, name, self._capture(name, has_token=False))

    def _capture(self, kind: str, has_token: bool = True):
        def capture(to, token=""):
            self.sent.append((kind, to, token if has_token else ""))

        return capture

    def last(self, kind: str, to: str) -> str:
        for sent_kind, sent_to, token in reversed(self.sent):
            if sent_kind == kind and sent_to == to:
                return token
        raise AssertionError(f"no {kind} mail to {to}")


class AuthFlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.originals = {name: getattr(mailer, name) for name in ("verify_email", "reset_password", "signup_exists", "password_changed")}
        try:
            cls.client = TestClient(app)
            cls.client.__enter__()
            health = cls.client.get("/health")
        except Exception as exc:  # pragma: no cover - environment
            raise unittest.SkipTest(f"api did not start: {exc}") from exc
        if health.json().get("db") != "ok":
            cls.client.__exit__(None, None, None)
            raise unittest.SkipTest("postgres is not running")

    @classmethod
    def tearDownClass(cls):
        for name, fn in cls.originals.items():
            setattr(mailer, name, fn)
        cls.client.__exit__(None, None, None)

    def setUp(self):
        self.mail = Mailbox()
        self.mail.install()
        self.client.cookies.clear()
        run(self._clear_rate())

    async def _clear_rate(self):
        async with await db.connect() as conn:
            await conn.execute("DELETE FROM rate_events WHERE bucket LIKE %s", ("%testclient%",))
            await conn.commit()

    def email(self) -> str:
        return f"user-{uuid4().hex[:10]}@example.com"

    def post(self, path: str, body: dict):
        return self.client.post(path, json=body, headers=HEADERS)

    def signed_up_and_verified(self) -> str:
        email = self.email()
        self.assertEqual(self.post("/v1/auth/signup", {"email": email, "password": GOOD}).status_code, 202)
        verified = self.post("/v1/auth/verify", {"token": self.mail.last("verify_email", email)})
        self.assertEqual(verified.status_code, 200, verified.text)
        return email

    def test_signup_verify_login_logout(self):
        email = self.email()
        first = self.post("/v1/auth/signup", {"email": email, "password": GOOD, "displayName": "Ana"})
        self.assertEqual(first.status_code, 202)
        blocked = self.post("/v1/auth/login", {"email": email, "password": GOOD})
        self.assertEqual(blocked.json()["code"], "email_unverified")
        verified = self.post("/v1/auth/verify", {"token": self.mail.last("verify_email", email)})
        self.assertEqual(verified.status_code, 200)
        self.assertTrue(verified.json()["emailVerified"])
        self.assertIn("httponly", verified.headers["set-cookie"].lower())
        self.assertIn("samesite=lax", verified.headers["set-cookie"].lower())
        self.assertEqual(self.client.get("/v1/me").json()["displayName"], "Ana")
        self.assertEqual(self.post("/v1/auth/logout", {}).status_code, 204)
        self.assertEqual(self.client.get("/v1/me").status_code, 401)
        login = self.post("/v1/auth/login", {"email": email.upper(), "password": GOOD})
        self.assertEqual(login.status_code, 200)

    def test_verify_token_single_use(self):
        email = self.email()
        self.post("/v1/auth/signup", {"email": email, "password": GOOD})
        token = self.mail.last("verify_email", email)
        self.assertEqual(self.post("/v1/auth/verify", {"token": token}).status_code, 200)
        self.assertEqual(self.post("/v1/auth/verify", {"token": token}).json()["code"], "bad_token")

    def test_no_enumeration(self):
        email = self.signed_up_and_verified()
        self.client.cookies.clear()
        again = self.post("/v1/auth/signup", {"email": email, "password": GOOD})
        fresh = self.post("/v1/auth/signup", {"email": self.email(), "password": GOOD})
        self.assertEqual((again.status_code, again.json()), (fresh.status_code, fresh.json()))
        self.mail.last("signup_exists", email)
        wrong = self.post("/v1/auth/login", {"email": email, "password": GOOD + "x"})
        unknown = self.post("/v1/auth/login", {"email": self.email(), "password": GOOD})
        self.assertEqual((wrong.status_code, wrong.json()), (unknown.status_code, unknown.json()))
        forgot_known = self.post("/v1/auth/forgot", {"email": email})
        forgot_unknown = self.post("/v1/auth/forgot", {"email": self.email()})
        self.assertEqual(forgot_known.json(), forgot_unknown.json())

    def test_weak_password_and_bad_email(self):
        self.assertEqual(self.post("/v1/auth/signup", {"email": self.email(), "password": "short"}).json()["code"], "weak_password")
        self.assertEqual(self.post("/v1/auth/signup", {"email": "nope", "password": GOOD}).json()["code"], "bad_email")

    def test_reset_revokes_sessions_and_is_single_use(self):
        email = self.signed_up_and_verified()
        old_cookie = dict(self.client.cookies)
        self.post("/v1/auth/forgot", {"email": email})
        token = self.mail.last("reset_password", email)
        weak = self.post("/v1/auth/reset", {"token": token, "password": "short"})
        self.assertEqual(weak.json()["code"], "weak_password")
        new_password = "amber lanterns drift slowly"
        self.assertEqual(self.post("/v1/auth/reset", {"token": token, "password": new_password}).status_code, 204)
        self.assertEqual(self.post("/v1/auth/reset", {"token": token, "password": new_password}).json()["code"], "bad_token")
        self.client.cookies.clear()
        self.client.cookies.update(old_cookie)
        self.assertEqual(self.client.get("/v1/me").status_code, 401)
        self.assertEqual(self.post("/v1/auth/login", {"email": email, "password": GOOD}).status_code, 401)
        self.assertEqual(self.post("/v1/auth/login", {"email": email, "password": new_password}).status_code, 200)

    def test_login_rate_limit_per_email(self):
        email = self.signed_up_and_verified()
        codes = [self.post("/v1/auth/login", {"email": email, "password": "wrong wrong wrong!"}).status_code for _ in range(11)]
        self.assertEqual(codes[-1], 429)
        self.assertEqual(self.post("/v1/auth/login", {"email": email, "password": GOOD}).status_code, 429)

    def test_origin_guard_blocks_cross_site_and_missing_header(self):
        body = {"email": self.email(), "password": GOOD}
        self.assertEqual(self.client.post("/v1/auth/signup", json=body).status_code, 403)
        evil = {"Origin": "https://evil.example", "X-Tidyai-Csrf": "1"}
        self.assertEqual(self.client.post("/v1/auth/signup", json=body, headers=evil).status_code, 403)

    def test_password_change_keeps_current_session_only(self):
        email = self.signed_up_and_verified()
        other = TestClient(app)
        self.assertEqual(other.post("/v1/auth/login", json={"email": email, "password": GOOD}, headers=HEADERS).status_code, 200)
        self.assertEqual(len(self.client.get("/v1/me/sessions").json()), 2)
        bad = self.post("/v1/me/password", {"currentPassword": "nope nope nope!!", "newPassword": "amber lanterns drift slowly"})
        self.assertEqual(bad.json()["code"], "bad_password")
        ok = self.post("/v1/me/password", {"currentPassword": GOOD, "newPassword": "amber lanterns drift slowly"})
        self.assertEqual(ok.status_code, 204)
        self.assertEqual(self.client.get("/v1/me").status_code, 200)
        self.assertEqual(other.get("/v1/me").status_code, 401)
        sessions = self.client.get("/v1/me/sessions").json()
        self.assertEqual([row["current"] for row in sessions], [True])

    def test_delete_account_requires_confirmation(self):
        email = self.signed_up_and_verified()
        wrong = self.client.request("DELETE", "/v1/me", json={"confirmEmail": "x@example.com", "password": GOOD}, headers=HEADERS)
        self.assertEqual(wrong.json()["code"], "confirm_mismatch")
        done = self.client.request("DELETE", "/v1/me", json={"confirmEmail": email, "password": GOOD}, headers=HEADERS)
        self.assertEqual(done.status_code, 204)
        self.assertEqual(self.client.get("/v1/me").status_code, 401)

    def test_google_link_drops_squatter_password(self):
        email = self.email()
        self.post("/v1/auth/signup", {"email": email, "password": GOOD})

        async def sign_in() -> tuple[str, dict]:
            async with await db.connect() as conn:
                async with conn.transaction():
                    user_id = await auth_routes.google_user(conn, f"sub-{uuid4().hex}", email, "Victim")
                return user_id, await store.user_by_id(conn, user_id)

        user_id, user = run(sign_in())
        self.assertIsNone(user["password_hash"])
        self.assertIsNotNone(user["email_verified_at"])
        self.assertEqual(self.post("/v1/auth/login", {"email": email, "password": GOOD}).status_code, 401)


if __name__ == "__main__":
    unittest.main()
