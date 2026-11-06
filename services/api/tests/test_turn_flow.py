"""One study turn against a local fake provider. Needs Postgres from docker compose."""

from __future__ import annotations

import json
import re
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

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
        chat = self.client.post(f"/v1/projects/{project['id']}/chats", json={"title": "New session"}).json()
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
            },
        ) as response:
            raw = "".join(response.iter_text())
        self.assertNotIn(secret, raw)
        self.assertIn("Torque is a turning effect.", raw)
        self.assertIn("event: notes", raw)
        page = self.client.get(f"/v1/projects/{project['id']}/pages/{project['rootPageId']}").json()
        texts = [block["payload"].get("text") for block in page["blocks"]]
        self.assertIn("Torque is r cross F.", texts)
        messages = self.client.get(f"/v1/chats/{chat['id']}/messages").json()
        self.assertEqual(messages[-1]["content"], "Torque is a turning effect.")
        renamed = self.client.get(f"/v1/projects/{project['id']}/chats").json()
        self.assertEqual(renamed[0]["title"], "What is torque?")

    def test_search_tool_returns_an_older_note(self):
        import asyncio
        from uuid import uuid4

        from psycopg.types.json import Json

        from tidyai_api import db

        secret = "sk-test-secret-value-123456"
        project = self.client.post("/v1/projects", json={"title": "Inertia"}).json()
        chat = self.client.post(f"/v1/projects/{project['id']}/chats", json={"title": "New session"}).json()

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
            },
        ) as response:
            raw = "".join(response.iter_text())
        self.assertIn("Searching notes", raw)
        self.assertIn("You wrote that inertia resists changes in motion.", raw)
        self.assertTrue(any("Inertia resists a change in motion." in body for body in _Provider.bodies))
        self.assertNotIn(secret, raw)


if __name__ == "__main__":
    unittest.main()
