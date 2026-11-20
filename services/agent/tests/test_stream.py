import json
import unittest
from unittest import mock

import httpx

from tidyai_agent.stream import (
    ProviderError,
    PublicOnlyTransport,
    check_base_url,
    configure_egress,
    is_public_address,
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


class EgressTests(unittest.TestCase):
    def tearDown(self):
        configure_egress(allow_private=True)

    def test_public_address_rules(self):
        for raw in ["8.8.8.8", "2606:4700:4700::1111"]:
            self.assertTrue(is_public_address(raw), raw)
        blocked = [
            "127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254",
            "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1%eth0",
            "::ffff:127.0.0.1", "64:ff9b::7f00:1", "not-an-ip",
        ]
        for raw in blocked:
            self.assertFalse(is_public_address(raw), raw)

    def test_local_mode_keeps_local_models(self):
        self.assertEqual(check_base_url("http://localhost:11434/v1/"), "http://localhost:11434/v1")

    def test_hosted_mode_needs_public_https_on_443(self):
        configure_egress(allow_private=False)
        self.assertEqual(check_base_url("https://api.openai.com/v1"), "https://api.openai.com/v1")
        for url in [
            "http://api.openai.com/v1",
            "https://api.openai.com:8443/v1",
            "https://127.0.0.1/v1",
            "https://169.254.169.254/latest",
            "https://[::1]/v1",
            "https://[::ffff:10.0.0.1]/v1",
        ]:
            with self.assertRaises(ProviderError, msg=url):
                check_base_url(url)

    def test_hosted_mode_blocks_names_that_resolve_inside(self):
        configure_egress(allow_private=False)

        async def call():
            async for _ in stream_chat(
                protocol="openai_chat",
                base_url="https://localhost/v1",
                api_key="sk-test-secret-value-123456",
                model="m",
                messages=[{"role": "user", "content": "hi"}],
            ):
                pass

        with self.assertRaises(ProviderError) as caught:
            _run(call())
        self.assertEqual(caught.exception.code, "blocked_host")

    def test_transport_dials_the_vetted_ip_with_the_real_sni(self):
        seen = {}

        class FakeLoop:
            async def getaddrinfo(self, host, port, type=0):
                seen["resolved"] = host
                return [(0, 0, 0, "", ("93.184.216.34", port))]

        async def capture(_self, request):
            seen["url"] = str(request.url)
            seen["host"] = request.headers["host"]
            seen["sni"] = request.extensions.get("sni_hostname")
            return httpx.Response(200, json={})

        async def call():
            with mock.patch("tidyai_agent.stream.asyncio.get_running_loop", return_value=FakeLoop()), \
                    mock.patch.object(httpx.AsyncHTTPTransport, "handle_async_request", capture):
                async with httpx.AsyncClient(transport=PublicOnlyTransport()) as client:
                    await client.get("https://api.example.com/v1/models")

        _run(call())
        self.assertEqual(seen["resolved"], "api.example.com")
        self.assertEqual(seen["url"], "https://93.184.216.34/v1/models")
        self.assertEqual(seen["host"], "api.example.com")
        self.assertEqual(seen["sni"], "api.example.com")


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

    def test_openai_web_search_adds_options(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(request.content.decode())
            body = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=body)

        async def collect():
            parts = []
            async for part in stream_chat(
                protocol="openai_chat",
                base_url="https://example.com/v1",
                api_key="sk-test-secret-value-123456",
                model="demo",
                messages=[{"role": "user", "content": "Hi"}],
                web_search=True,
                transport=httpx.MockTransport(handler),
            ):
                parts.append(part)
            return "".join(parts)

        self.assertEqual(_run(collect()), "ok")
        self.assertEqual(seen["body"]["web_search_options"], {"search_context_size": "medium"})

    def test_gemini_web_search_adds_google_search_tool(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(request.content.decode())
            body = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n'
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=body)

        async def collect():
            parts = []
            async for part in stream_chat(
                protocol="gemini",
                base_url="https://generativelanguage.googleapis.com/v1beta",
                api_key="AIzaSySomethingLongEnough",
                model="gemini-test",
                messages=[{"role": "user", "content": "Hi"}],
                web_search=True,
                transport=httpx.MockTransport(handler),
            ):
                parts.append(part)
            return "".join(parts)

        self.assertEqual(_run(collect()), "ok")
        self.assertEqual(seen["body"]["tools"], [{"google_search": {}}])


if __name__ == "__main__":
    unittest.main()
