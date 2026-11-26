import unittest
from unittest.mock import AsyncMock, patch

from tidyai_agent.notes import apply_note_ops, note_ops_from_answer, parse_ops_payload
from tidyai_agent.stream import ProviderError


def _ids():
    counter = {"n": 0}

    def new_id() -> str:
        counter["n"] += 1
        return f"id-{counter['n']}"

    return new_id


class ParseTests(unittest.TestCase):
    def test_reads_fenced_json(self):
        ops = parse_ops_payload('```json\n{"ops":[{"op":"delete","blockId":"b"}]}\n```')
        self.assertEqual(ops[0]["op"], "delete")


class ApplyTests(unittest.TestCase):
    def setUp(self):
        self.pages = [
            {
                "id": "page-1",
                "project_id": "proj",
                "parent_id": None,
                "title": "Mechanics",
                "depth": 0,
                "position": 0,
            }
        ]
        self.blocks = [
            {
                "id": "block-1",
                "page_id": "page-1",
                "position": 0,
                "type": "paragraph",
                "payload": {"text": "old"},
                "version": 2,
            }
        ]

    def test_replace_bumps_version(self):
        result = apply_note_ops(
            self.pages,
            self.blocks,
            [
                {
                    "op": "replace",
                    "blockId": "block-1",
                    "type": "paragraph",
                    "seenVersion": 2,
                    "payload": {"text": "new"},
                }
            ],
            project_id="proj",
            new_id=_ids(),
        )
        self.assertEqual(result["blocks"][0]["payload"]["text"], "new")
        self.assertEqual(result["blocks"][0]["version"], 3)
        self.assertEqual(self.blocks[0]["payload"]["text"], "old")

    def test_stale_version_is_skipped(self):
        result = apply_note_ops(
            self.pages,
            self.blocks,
            [
                {
                    "op": "replace",
                    "blockId": "block-1",
                    "type": "paragraph",
                    "seenVersion": 1,
                    "payload": {"text": "race"},
                }
            ],
            project_id="proj",
            new_id=_ids(),
        )
        self.assertEqual(result["blocks"][0]["payload"]["text"], "old")
        self.assertTrue(result["skipped"])

    def test_html_insert_is_skipped(self):
        result = apply_note_ops(
            self.pages,
            self.blocks,
            [{"op": "insert", "parentId": "page-1", "type": "html", "payload": {"text": "<script>"}}],
            project_id="proj",
            new_id=_ids(),
        )
        self.assertEqual(len(result["blocks"]), 1)
        self.assertTrue(result["skipped"])

    def test_insert_and_child_page(self):
        result = apply_note_ops(
            self.pages,
            self.blocks,
            [
                {
                    "op": "insert",
                    "parentId": "page-1",
                    "type": "child_page",
                    "payload": {"title": "Torque"},
                }
            ],
            project_id="proj",
            new_id=_ids(),
        )
        self.assertEqual(len(result["pages"]), 2)
        self.assertEqual(result["pages"][1]["depth"], 1)
        self.assertEqual(result["blocks"][-1]["type"], "child_page")
        self.assertIn("page-1", result["touchedPageIds"])


class NoteOpsFromAnswerTests(unittest.IsolatedAsyncioTestCase):
    async def test_prefers_json_object_then_parses(self):
        with patch(
            "tidyai_agent.notes.complete_chat",
            new=AsyncMock(return_value='{"ops":[{"op":"delete","blockId":"b"}]}'),
        ) as complete:
            ops, failure = await note_ops_from_answer(
                outline="- page p",
                answer="Torque is r cross F.",
                protocol="openai_chat",
                base_url="https://api.groq.com/openai/v1",
                api_key="sk-test",
                model="llama",
            )
        self.assertIsNone(failure)
        self.assertEqual(ops[0]["op"], "delete")
        self.assertTrue(complete.await_args.kwargs.get("json_object"))

    async def test_retries_without_json_object_on_400(self):
        calls = {"n": 0}

        async def fake(**kwargs):
            calls["n"] += 1
            if kwargs.get("json_object"):
                raise ProviderError("upstream", "Provider returned 400. response_format")
            return '{"ops":[]}'

        with patch("tidyai_agent.notes.complete_chat", new=fake):
            ops, failure = await note_ops_from_answer(
                outline="- page p",
                answer="hi",
                protocol="openai_chat",
                base_url="https://api.groq.com/openai/v1",
                api_key="sk-test",
                model="llama",
            )
        self.assertEqual((ops, failure, calls["n"]), ([], None, 2))


if __name__ == "__main__":
    unittest.main()
