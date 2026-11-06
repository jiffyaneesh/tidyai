import unittest

import httpx

from tidyai_agent.retrieve import (
    EMBEDDING_DIM,
    SEARCH_TOOLS,
    ToolAssembler,
    append_tool_results,
    chunk_text,
    format_hits,
    rrf,
)
from tidyai_agent.stream import embed_texts, stream_chat


def _run(coro):
    import asyncio

    return asyncio.run(coro)


class ChunkTests(unittest.TestCase):
    def test_short_block_is_one_chunk_with_heading(self):
        self.assertEqual(chunk_text("Inertia resists change.", "Page: Motion"), ["Page: Motion\nInertia resists change."])

    def test_long_block_splits_and_stops(self):
        parts = chunk_text("a" * 9000, "Page: Motion")
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(part.startswith("Page: Motion\n") for part in parts))
        self.assertLessEqual(len(parts), 8)


class RrfTests(unittest.TestCase):
    def test_item_in_both_lists_outranks_a_single_hit(self):
        fused = rrf([["a", "b"], ["b", "c"]])
        self.assertEqual(fused[0], "b")
        self.assertEqual(set(fused), {"a", "b", "c"})


class ToolTests(unittest.TestCase):
    def test_openai_fragments_become_one_call(self):
        assembler = ToolAssembler()
        assembler.feed(
            "openai_chat",
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": "search_notes"}}]}}]},
        )
        assembler.feed(
            "openai_chat",
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "{\"query\":"}}]}}]},
        )
        assembler.feed(
            "openai_chat",
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "\"inertia\"}"}}]}}]},
        )
        calls = assembler.calls()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].name, "search_notes")
        self.assertEqual(calls[0].arguments, '{"query":"inertia"}')

    def test_followup_keeps_the_question_and_adds_the_result(self):
        calls = ToolAssembler()
        calls.feed(
            "openai_chat",
            {
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {"id": "call_1", "function": {"name": "search_notes", "arguments": "{\"query\":\"inertia\"}"}}
                            ]
                        }
                    }
                ]
            },
        )
        messages = append_tool_results(
            [{"role": "user", "content": "What did I write?"}],
            calls.calls(),
            ["[block] Inertia resists change."],
        )
        self.assertEqual(messages[0]["content"], "What did I write?")
        self.assertEqual(messages[-1]["role"], "tool")
        self.assertIn("Inertia resists change.", messages[-1]["content"])

    def test_stream_sends_the_tool_and_still_yields_text(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["body"] = request.read().decode()
            body = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n'
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=body)

        assembler = ToolAssembler()

        async def collect():
            parts = []
            async for part in stream_chat(
                protocol="openai_chat",
                base_url="https://example.com/v1",
                api_key="sk-test-secret-value-123456",
                model="demo",
                messages=[{"role": "user", "content": "Hi"}],
                tools=SEARCH_TOOLS,
                assembler=assembler,
                transport=httpx.MockTransport(handler),
            ):
                parts.append(part)
            return "".join(parts)

        self.assertEqual(_run(collect()), "Hello")
        self.assertIn("search_notes", seen["body"])
        self.assertEqual(assembler.calls(), [])


class EmbedTests(unittest.TestCase):
    def test_openai_embedding_uses_the_fixed_width(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={"data": [{"index": 0, "embedding": [0.1] * EMBEDDING_DIM}]},
            )

        async def collect():
            return await embed_texts(
                protocol="openai_chat",
                base_url="https://example.com/v1",
                api_key="sk-test-secret-value-123456",
                model="text-embedding-3-small",
                texts=["inertia"],
                transport=httpx.MockTransport(handler),
            )

        vectors = _run(collect())
        self.assertEqual(len(vectors), 1)
        self.assertEqual(len(vectors[0]), EMBEDDING_DIM)

    def test_wrong_width_is_dropped(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.1, 0.2]}]})

        async def collect():
            return await embed_texts(
                protocol="openai_chat",
                base_url="https://example.com/v1",
                api_key="sk-test-secret-value-123456",
                model="text-embedding-3-small",
                texts=["inertia"],
                transport=httpx.MockTransport(handler),
            )

        self.assertEqual(_run(collect()), [None])


class FormatTests(unittest.TestCase):
    def test_empty_hits_say_so(self):
        self.assertEqual(format_hits([]), "No matching notes.")
