"""Credential primitives and the origin guard. No database needed."""

from __future__ import annotations

import asyncio
import unittest

from tidyai_api.security import (
    OriginGuard,
    hash_password,
    needs_rehash,
    new_token,
    normalize_email,
    password_problem,
    safe_next,
    token_digest,
    verify_password,
)


class PasswordTest(unittest.TestCase):
    def test_hash_is_argon2id_at_owasp_floor(self):
        stored = hash_password("a long study phrase here")
        self.assertTrue(stored.startswith("$argon2id$v=19$m=19456,t=2,p=1$"))
        self.assertTrue(verify_password(stored, "a long study phrase here"))
        self.assertFalse(verify_password(stored, "a long study phrase hers"))
        self.assertFalse(needs_rehash(stored))

    def test_missing_or_garbage_hash_is_false_not_error(self):
        self.assertFalse(verify_password(None, "whatever whatever"))
        self.assertFalse(verify_password("not-a-hash", "whatever whatever"))

    def test_policy(self):
        self.assertIn("15", password_problem("short pass") or "")
        self.assertIsNotNone(password_problem("passwordpassword"))
        self.assertIsNotNone(password_problem("aaaaabbbbbaaaaabbbbb"))
        self.assertIsNotNone(password_problem("annesh annesh!!", "annesh@example.com"))
        self.assertIsNotNone(password_problem("tidyai tidyai 2026", ""))
        self.assertIsNone(password_problem("annesh likes violet tea", "annesh@example.com"))
        self.assertIsNotNone(password_problem("x" * 129))
        self.assertIsNone(password_problem("violet kettles hum at dawn"))
        self.assertIsNone(password_problem("ünïcödé phrase ok"))


class TokenTest(unittest.TestCase):
    def test_token_digest_round_trip(self):
        token, digest = new_token()
        self.assertGreaterEqual(len(token), 40)
        self.assertEqual(token_digest(token), digest)
        self.assertNotIn(token, digest)

    def test_email(self):
        self.assertEqual(normalize_email("  Ana@Example.COM "), "ana@example.com")
        for bad in ["", "no-at", "a@b", "a b@c.de", "a@@b.co", "x" * 250 + "@a.co"]:
            self.assertIsNone(normalize_email(bad), bad)

    def test_safe_next_blocks_open_redirects(self):
        self.assertEqual(safe_next("/settings/account"), "/settings/account")
        for bad in [None, "", "https://evil.com", "//evil.com", "/\\evil.com", "/ok\\..", "/a\nb", "javascript:alert(1)"]:
            self.assertEqual(safe_next(bad), "/app", bad)


class OriginGuardTest(unittest.TestCase):
    def setUp(self):
        self.guard = OriginGuard(app=None, allowed_origins=("http://127.0.0.1:5173",))

    def test_rules(self):
        ok = {"x-tidyai-csrf": "1", "origin": "http://127.0.0.1:5173"}
        self.assertTrue(self.guard.allows(ok))
        self.assertFalse(self.guard.allows({"origin": "http://127.0.0.1:5173"}))
        self.assertFalse(self.guard.allows({"x-tidyai-csrf": "1", "origin": "https://evil.example"}))
        self.assertFalse(self.guard.allows({"x-tidyai-csrf": "1"}))
        self.assertTrue(self.guard.allows({"x-tidyai-csrf": "1", "sec-fetch-site": "same-origin"}))
        self.assertFalse(self.guard.allows({"x-tidyai-csrf": "1", "sec-fetch-site": "cross-site"}))

    def test_asgi_rejects_unsafe_and_passes_get(self):
        calls: list[str] = []

        async def inner(scope, receive, send):
            calls.append(scope["method"])

        guard = OriginGuard(inner, ("http://127.0.0.1:5173",))
        sent: list[dict] = []

        async def send(message):
            sent.append(message)

        async def run(method: str, headers: list[tuple[bytes, bytes]]):
            await guard({"type": "http", "method": method, "headers": headers}, None, send)

        asyncio.run(run("GET", []))
        asyncio.run(run("POST", [(b"origin", b"https://evil.example"), (b"x-tidyai-csrf", b"1")]))
        self.assertEqual(calls, ["GET"])
        self.assertEqual(sent[0]["status"], 403)


if __name__ == "__main__":
    unittest.main()
