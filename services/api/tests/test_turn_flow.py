"""One study turn against a local fake provider. Needs Postgres from docker compose."""

from __future__ import annotations

import json
import re
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import AsyncMock, patch

from tests import testdb  # noqa: F401  isort: skip
from fastapi.testclient import TestClient

from tidyai_api.main import app


class _Provider(BaseHTTPRequestHandler):
    bodies: list[str] = []

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        text = raw.decode()
        _Provider.bodies.append(text)
        secret = self.headers.get("Authorization", "")
        if "sk-test-secret-value-123456" not in secret:
            self.send_response(401)
            self.end_headers()
            return
        if "You update study notes" in text:
            page = re.search(r"page ([0-9a-fA-F-]{36})", text)
            page_id = page.group(1) if page else ""
            content = json.dumps(
                {
                    "ops": [
                        {
                            "op": "insert",
                            "parentId": page_id,
                            "type": "paragraph",
                            "payload": {"text": "Torque is r cross F."},
                        }
                    ]
                }
            )
            payload = json.dumps({"choices": [{"delta": {"content": content}}]})
        elif "What did I write about inertia" in text and "tool_call_id" not in text:
            payload = json.dumps(
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call_inertia",
                                        "function": {
                                            "name": "search_notes",
                                            "arguments": '{"query":"inertia"}',
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                }
            )
        else:
            content = (
                "You wrote that inertia resists changes in motion."
                if "inertia" in text
                else "Torque is a turning effect."
            )
            payload = json.dumps({"choices": [{"delta": {"content": content}}]})
        body = f"data: {payload}\n\ndata: [DONE]\n\n".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        return


class TurnFlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.client = TestClient(app)
            cls.client.__enter__()
            health = cls.client.get("/health")
        except Exception as exc:  # pragma: no cover - environment
            raise unittest.SkipTest(f"api did not start: {exc}") from exc
        if health.json().get("db") != "ok":
            cls.client.__exit__(None, None, None)
            raise unittest.SkipTest("postgres is not running")
        testdb.sign_in(cls.client)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Provider)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "server", None):
            cls.server.shutdown()
        if getattr(cls, "client", None):
            cls.client.__exit__(None, None, None)

    def test_stream_saves_the_answer_and_applies_a_note(self):
        secret = "sk-test-secret-value-123456"
        project = self.client.post("/v1/projects", json={"title": "Flow test"}).json()
        chat = self.client.post(f"/v1/projects/{project['id']}/chats", json={"title": "Untitled chat"}).json()
        _Provider.bodies.clear()
        # Local/Groq-style host: server search_web, not OpenAI web_search_options.
        fake_hits = [{"title": "Torque", "url": "https://example.com/torque", "snippet": "Torque turns."}]
        with patch("tidyai_api.main.search_web", new=AsyncMock(return_value=fake_hits)):
            with self.client.stream(
                "POST",
                f"/v1/chats/{chat['id']}/turns",
                headers={"X-Provider-Key": secret},
                json={
                    "text": "What is torque?",
                    "protocol": "openai_chat",
                    "baseUrl": f"http://127.0.0.1:{self.port}/v1",
                    "model": "fake",
                    "pageId": project["rootPageId"],
                    "mode": "web",
                },
            ) as response:
                raw = "".join(response.iter_text())
        self.assertNotIn(secret, raw)
        self.assertIn("Searching the web", raw)
        self.assertIn("Torque is a turning effect.", raw)
        self.assertIn("event: notes", raw)
        self.assertTrue(any("search_web" in body for body in _Provider.bodies))
        self.assertFalse(any("web_search_options" in body for body in _Provider.bodies))
        page = self.client.get(f"/v1/projects/{project['id']}/pages/{project['rootPageId']}").json()
        texts = [block["payload"].get("text") for block in page["blocks"]]
        self.assertIn("Torque is r cross F.", texts)
        messages = self.client.get(f"/v1/chats/{chat['id']}/messages").json()
        self.assertEqual(messages[-1]["content"], "Torque is a turning effect.")
        renamed = self.client.get(f"/v1/projects/{project['id']}/chats").json()
        self.assertEqual(renamed[0]["title"], "What is torque?")

    def test_openai_host_still_uses_native_web_search(self):
        secret = "sk-test-secret-value-123456"
        project = self.client.post("/v1/projects", json={"title": "OpenAI web"}).json()
        chat = self.client.post(f"/v1/projects/{project['id']}/chats", json={"title": "Untitled chat"}).json()
        _Provider.bodies.clear()
        # Point at the fake provider but claim an OpenAI hostname via native_web_search patch.
        with patch("tidyai_api.main.native_web_search", return_value=True):
            with self.client.stream(
                "POST",
                f"/v1/chats/{chat['id']}/turns",
                headers={"X-Provider-Key": secret},
                json={
                    "text": "What is torque?",
                    "protocol": "openai_chat",
                    "baseUrl": f"http://127.0.0.1:{self.port}/v1",
                    "model": "fake",
                    "pageId": project["rootPageId"],
                    "mode": "web",
                },
            ) as response:
                raw = "".join(response.iter_text())
        self.assertIn("Torque is a turning effect.", raw)
        self.assertIn("event: notes", raw)
        self.assertTrue(any("web_search_options" in body for body in _Provider.bodies))
        self.assertNotIn("Searching the web", raw)

    def test_search_tool_returns_an_older_note(self):
        import asyncio
        from uuid import uuid4

        from psycopg.types.json import Json

        from tidyai_api import db

        secret = "sk-test-secret-value-123456"
        project = self.client.post("/v1/projects", json={"title": "Inertia"}).json()
        chat = self.client.post(f"/v1/projects/{project['id']}/chats", json={"title": "Untitled chat"}).json()

        async def seed():
            async with await db.connect() as conn:
                await conn.execute(
                    """
                    INSERT INTO blocks (id, page_id, position, type, payload, version)
                    VALUES (%s, %s, 0, 'paragraph', %s, 1)
                    """,
                    (
                        str(uuid4()),
                        project["rootPageId"],
                        Json({"text": "Inertia resists a change in motion."}),
                    ),
                )
                await conn.commit()
            await db.sync_project_chunks(project["id"])

        asyncio.run(seed())
        _Provider.bodies.clear()
        with self.client.stream(
            "POST",
            f"/v1/chats/{chat['id']}/turns",
            headers={"X-Provider-Key": secret},
            json={
                "text": "What did I write about inertia?",
                "protocol": "openai_chat",
                "baseUrl": f"http://127.0.0.1:{self.port}/v1",
                "model": "fake",
                "pageId": project["rootPageId"],
                "mode": "notes",
            },
        ) as response:
            raw = "".join(response.iter_text())
        self.assertIn("Searching notes", raw)
        self.assertIn("You wrote that inertia resists changes in motion.", raw)
        self.assertTrue(any("Inertia resists a change in motion." in body for body in _Provider.bodies))
        self.assertNotIn("event: notes", raw)
        self.assertNotIn(secret, raw)

    def test_memory_cue_forces_search_before_the_model(self):
        import asyncio
        from uuid import uuid4

        from psycopg.types.json import Json

        from tidyai_api import db

        secret = "sk-test-secret-value-123456"
        project = self.client.post("/v1/projects", json={"title": "Memory"}).json()
        chat = self.client.post(f"/v1/projects/{project['id']}/chats", json={"title": "Untitled chat"}).json()

        async def seed():
            async with await db.connect() as conn:
                await conn.execute(
                    """
                    INSERT INTO blocks (id, page_id, position, type, payload, version)
                    VALUES (%s, %s, 0, 'paragraph', %s, 1)
                    """,
                    (
                        str(uuid4()),
                        project["rootPageId"],
                        Json({"text": "Angular momentum is conserved."}),
                    ),
                )
                await conn.commit()
            await db.sync_project_chunks(project["id"])

        asyncio.run(seed())
        _Provider.bodies.clear()
        with self.client.stream(
            "POST",
            f"/v1/chats/{chat['id']}/turns",
            headers={"X-Provider-Key": secret},
            json={
                "text": "remind me what we covered about momentum",
                "protocol": "openai_chat",
                "baseUrl": f"http://127.0.0.1:{self.port}/v1",
                "model": "fake",
                "pageId": project["rootPageId"],
                "mode": "notes",
            },
        ) as response:
            raw = "".join(response.iter_text())
        self.assertIn("Searching notes", raw)
        self.assertIn("event: citations", raw)
        self.assertTrue(any("Angular momentum is conserved." in body for body in _Provider.bodies))
        self.assertNotIn("event: notes", raw)
        self.assertNotIn(secret, raw)

    def test_put_page_blocks_replaces_the_tree(self):
        from uuid import uuid4

        project = self.client.post("/v1/projects", json={"title": "Notebook"}).json()
        page_id = project["rootPageId"]
        heading_id = str(uuid4())
        para_id = str(uuid4())
        first = self.client.put(
            f"/v1/projects/{project['id']}/pages/{page_id}/blocks",
            json={
                "blocks": [
                    {"id": heading_id, "type": "heading", "payload": {"text": "Laws", "level": 1}},
                    {"id": para_id, "type": "paragraph", "payload": {"text": "F = ma"}},
                ]
            },
        )
        self.assertEqual(first.status_code, 200, first.text)
        body = first.json()
        self.assertEqual([row["type"] for row in body], ["heading", "paragraph"])
        self.assertEqual(body[0]["payload"]["text"], "Laws")
        again = self.client.put(
            f"/v1/projects/{project['id']}/pages/{page_id}/blocks",
            json={
                "blocks": [
                    {"id": para_id, "type": "paragraph", "payload": {"text": "F = ma"}},
                    {
                        "id": str(uuid4()),
                        "type": "bulleted_list_item",
                        "payload": {"text": "Action equals reaction"},
                    },
                ]
            },
        )
        self.assertEqual(again.status_code, 200, again.text)
        page = self.client.get(f"/v1/projects/{project['id']}/pages/{page_id}").json()
        self.assertEqual(len(page["blocks"]), 2)
        self.assertEqual(page["blocks"][0]["id"], para_id)
        self.assertEqual(page["blocks"][0]["version"], 1)
        self.assertEqual(page["blocks"][1]["type"], "bulleted_list_item")

    def test_patch_chat_title(self):
        project = self.client.post("/v1/projects", json={"title": "Rename subject"}).json()
        chat = self.client.post(
            f"/v1/projects/{project['id']}/chats",
            json={"title": "Untitled chat"},
        ).json()
        updated = self.client.patch(f"/v1/chats/{chat['id']}", json={"title": "Torque drills"})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["title"], "Torque drills")
        missing = self.client.patch(
            "/v1/chats/00000000-0000-0000-0000-000000000000",
            json={"title": "Nope"},
        )
        self.assertEqual(missing.status_code, 404)

    def test_other_users_data_is_not_found(self):
        project = self.client.post("/v1/projects", json={"title": "Private"}).json()
        chat = self.client.post(f"/v1/projects/{project['id']}/chats", json={"title": "Mine"}).json()
        from uuid import uuid4

        block_id = str(uuid4())
        page_path = f"/v1/projects/{project['id']}/pages/{project['rootPageId']}"
        saved = self.client.put(
            f"{page_path}/blocks",
            json={"blocks": [{"id": block_id, "type": "paragraph", "payload": {"text": "secret"}}]},
        )
        self.assertEqual(saved.status_code, 200, saved.text)

        anonymous = TestClient(app)
        self.assertEqual(anonymous.get("/v1/projects").status_code, 401)
        self.assertEqual(anonymous.get(page_path).status_code, 401)

        other = TestClient(app)
        testdb.sign_in(other)
        self.assertNotIn(project["id"], [row["id"] for row in other.get("/v1/projects").json()])
        attempts = [
            other.get(f"/v1/projects/{project['id']}/chats"),
            other.post(f"/v1/projects/{project['id']}/chats", json={"title": "x"}),
            other.patch(f"/v1/chats/{chat['id']}", json={"title": "x"}),
            other.get(f"/v1/chats/{chat['id']}/messages"),
            other.get(f"/v1/projects/{project['id']}/pages"),
            other.get(page_path),
            other.put(f"{page_path}/blocks", json={"blocks": []}),
            other.patch(f"/v1/blocks/{block_id}", json={"version": 1, "payload": {"text": "x"}}),
            other.post(
                f"/v1/chats/{chat['id']}/turns",
                headers={"X-Provider-Key": "sk-test-secret-value-123456"},
                json={"text": "hi", "protocol": "openai_chat", "baseUrl": "http://127.0.0.1:1/v1", "model": "fake"},
            ),
        ]
        self.assertEqual([r.status_code for r in attempts], [404] * len(attempts))
        theirs = other.post("/v1/projects", json={"title": "Theirs"}).json()
        stolen = other.put(
            f"/v1/projects/{theirs['id']}/pages/{theirs['rootPageId']}/blocks",
            json={"blocks": [{"id": block_id, "type": "paragraph", "payload": {"text": "moved"}}]},
        )
        self.assertEqual(stolen.status_code, 409)
        page = self.client.get(page_path).json()
        self.assertEqual([b["payload"].get("text") for b in page["blocks"]], ["secret"])


if __name__ == "__main__":
    unittest.main()
