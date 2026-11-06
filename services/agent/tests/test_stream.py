import unittest

import httpx

from tidyai_agent.stream import (
    ProviderError,
    check_base_url,
    redact,
    stream_chat,
    text_from_sse_line,
)


def _run(coro):
    import asyncio

    return asyncio.run(coro)


class RedactTests(unittest.TestCase):
    def test_strips_provider_secrets(self):
        raw = "nope sk-test-secret-value-123456 and AIzaSySomethingLongEnough"
        cleaned = redact(raw)
        self.assertNotIn("sk-test-secret-value-123456", cleaned)
        self.assertNotIn("AIzaSySomethingLongEnough", cleaned)


class UrlTests(unittest.TestCase):
    def test_rejects_file_urls_and_embedded_passwords(self):
        with self.assertRaises(ProviderError):
            check_base_url("file:///tmp/model")
        with self.assertRaises(ProviderError):
            check_base_url("https://user:secret@example.com/v1")


class ParseTests(unittest.TestCase):
    def test_openai_delta(self):
        line = 'data: {"choices":[{"delta":{"content":"Hi"}}]}'
        self.assertEqual(text_from_sse_line("openai_chat", line), "Hi")

    def test_gemini_delta(self):
        line = 'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}'
        self.assertEqual(text_from_sse_line("gemini", line), "Hi")

    def test_done_marker_is_empty(self):
        self.assertIsNone(text_from_sse_line("openai_chat", "data: [DONE]"))


class StreamTests(unittest.TestCase):
    def test_openai_stream_uses_bearer_header_and_does_not_follow_redirects(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["auth"] = request.headers.get("authorization")
            seen["url"] = str(request.url)
            body = (
                'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
                "data: [DONE]\n\n"
            )
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                text=body,
            )

        async def collect():
            parts = []
            async for part in stream_chat(
                protocol="openai_chat",
                base_url="https://example.com/v1",
                api_key="sk-test-secret-value-123456",
                model="demo",
                messages=[{"role": "user", "content": "Hi"}],
                transport=httpx.MockTransport(handler),
            ):
                parts.append(part)
            return "".join(parts)

        self.assertEqual(_run(collect()), "Hello")
        self.assertEqual(seen["auth"], "Bearer sk-test-secret-value-123456")
        self.assertTrue(seen["url"].endswith("/v1/chat/completions"))

    def test_error_body_does_not_echo_the_key(self):
        secret = "sk-test-secret-value-123456"

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, text=f"bad {secret}")

        async def collect():
            async for _part in stream_chat(
                protocol="openai_chat",
                base_url="https://example.com/v1",
                api_key=secret,
                model="demo",
                messages=[{"role": "user", "content": "Hi"}],
                transport=httpx.MockTransport(handler),
            ):
                pass

        with self.assertRaises(ProviderError) as caught:
            _run(collect())
        self.assertNotIn(secret, caught.exception.message)

    def test_redirect_is_not_followed(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(302, headers={"location": "https://evil.example/steal"})

        async def collect():
            async for _part in stream_chat(
                protocol="gemini",
                base_url="https://generativelanguage.googleapis.com/v1beta",
                api_key="AIzaSySomethingLongEnough",
                model="gemini-test",
                messages=[{"role": "user", "content": "Hi"}],
                transport=httpx.MockTransport(handler),
            ):
                pass

        with self.assertRaises(ProviderError) as caught:
            _run(collect())
        self.assertIn("redirected", caught.exception.message.lower())
        self.assertNotIn("AIzaSySomethingLongEnough", caught.exception.message)


if __name__ == "__main__":
    unittest.main()
