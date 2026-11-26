"""Unit tests for keyless web search helpers."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from tidyai_agent.websearch import (
    _strip_markup,
    format_web_hits,
    native_web_search,
    search_web,
)


class NativeWebSearchTests(unittest.TestCase):
    def test_gemini_and_openai_hosts(self):
        self.assertTrue(native_web_search("gemini", "https://generativelanguage.googleapis.com"))
        self.assertTrue(native_web_search("openai_chat", "https://api.openai.com/v1"))
        self.assertTrue(native_web_search("openai_chat", "https://us.api.openai.com/v1"))

    def test_groq_and_local_use_server_search(self):
        self.assertFalse(native_web_search("openai_chat", "https://api.groq.com/openai/v1"))
        self.assertFalse(native_web_search("openai_chat", "http://127.0.0.1:8000/v1"))
        self.assertFalse(native_web_search("openai_chat", "https://openrouter.ai/api/v1"))


class FormatTests(unittest.TestCase):
    def test_format_and_strip(self):
        self.assertEqual(_strip_markup('Torque is <span class="searchmatch">r</span> cross F.'), "Torque is r cross F.")
        text = format_web_hits([{"title": "A", "url": "https://a.test", "snippet": "hi"}])
        self.assertIn("[A](https://a.test)", text)
        self.assertEqual(format_web_hits([]), "No web results.")


class SearchWebTests(unittest.IsolatedAsyncioTestCase):
    async def test_builds_hits_from_wikipedia_json(self):
        search_payload = {
            "query": {
                "search": [
                    {"title": "Torque", "snippet": "Torque is <span class=\"searchmatch\">r</span> cross F."},
                ]
            }
        }
        summary_payload = {"extract": "In physics and mechanics, torque is the rotational equivalent of linear force."}

        search_response = MagicMock(status_code=200)
        search_response.json.return_value = search_payload
        summary_response = MagicMock(status_code=200)
        summary_response.json.return_value = summary_payload

        client = MagicMock()
        client.get = AsyncMock(side_effect=[search_response, summary_response])
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)

        with patch("tidyai_agent.websearch.httpx.AsyncClient", return_value=client):
            hits = await search_web("torque")
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["title"], "Torque")
        self.assertEqual(hits[0]["url"], "https://en.wikipedia.org/wiki/Torque")
        self.assertIn("rotational equivalent", hits[0]["snippet"])


if __name__ == "__main__":
    unittest.main()
