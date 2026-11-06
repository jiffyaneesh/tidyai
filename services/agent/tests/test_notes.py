import unittest

from tidyai_agent.notes import apply_note_ops, parse_ops_payload


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


if __name__ == "__main__":
    unittest.main()
