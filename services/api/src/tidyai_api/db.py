"""Postgres access. This module does not call a model."""

from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Json

from tidyai_agent.retrieve import EMBEDDING_DIM, block_source, chunks_for_source, rrf

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://tidyai:tidyai@localhost:5434/tidyai",
)


def connect() -> AsyncConnection:
    return AsyncConnection.connect(DATABASE_URL, row_factory=dict_row)


async def init_schema() -> None:
    sql = (Path(__file__).parent / "schema.sql").read_text()
    async with await connect() as conn:
        for statement in sql.split(";"):
            stmt = statement.strip()
            if stmt:
                await conn.execute(stmt)
        await conn.commit()


async def list_projects() -> list[dict]:
    async with await connect() as conn:
        cur = await conn.execute("SELECT id, title FROM projects ORDER BY created_at")
        return await cur.fetchall()


async def create_project(title: str) -> dict:
    project_id = str(uuid4())
    page_id = str(uuid4())
    async with await connect() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO projects (id, title) VALUES (%s, %s)",
                (project_id, title),
            )
            await conn.execute(
                """
                INSERT INTO pages (id, project_id, parent_id, title, depth, position)
                VALUES (%s, %s, NULL, %s, 0, 0)
                """,
                (page_id, project_id, title),
            )
    return {"id": project_id, "title": title, "rootPageId": page_id}


async def list_chats(project_id: str) -> list[dict]:
    async with await connect() as conn:
        cur = await conn.execute(
            "SELECT id, project_id, title FROM chats WHERE project_id = %s ORDER BY created_at",
            (project_id,),
        )
        rows = await cur.fetchall()
    return [_chat(row) for row in rows]


async def create_chat(project_id: str, title: str) -> dict | None:
    chat_id = str(uuid4())
    async with await connect() as conn:
        cur = await conn.execute("SELECT id FROM projects WHERE id = %s", (project_id,))
        if await cur.fetchone() is None:
            return None
        await conn.execute(
            "INSERT INTO chats (id, project_id, title) VALUES (%s, %s, %s)",
            (chat_id, project_id, title),
        )
        await conn.commit()
    return {"id": chat_id, "projectId": project_id, "title": title}


async def list_messages(chat_id: str) -> list[dict] | None:
    async with await connect() as conn:
        found = await conn.execute("SELECT id FROM chats WHERE id = %s", (chat_id,))
        if await found.fetchone() is None:
            return None
        cur = await conn.execute(
            """
            SELECT id, role, content FROM messages
            WHERE chat_id = %s ORDER BY created_at
            """,
            (chat_id,),
        )
        return await cur.fetchall()


async def list_pages(project_id: str) -> list[dict] | None:
    async with await connect() as conn:
        found = await conn.execute("SELECT id FROM projects WHERE id = %s", (project_id,))
        if await found.fetchone() is None:
            return None
        cur = await conn.execute(
            """
            SELECT id, parent_id, title, depth, position
            FROM pages WHERE project_id = %s
            ORDER BY depth, position, title
            """,
            (project_id,),
        )
        return await cur.fetchall()


async def get_page(project_id: str, page_id: str) -> dict | None:
    async with await connect() as conn:
        cur = await conn.execute(
            """
            SELECT id, parent_id, title, depth, position
            FROM pages WHERE id = %s AND project_id = %s
            """,
            (page_id, project_id),
        )
        page = await cur.fetchone()
        if page is None:
            return None
        blocks = await conn.execute(
            """
            SELECT id, page_id, position, type, payload, version
            FROM blocks WHERE page_id = %s ORDER BY position
            """,
            (page_id,),
        )
        page = dict(page)
        page["blocks"] = await blocks.fetchall()
        return page


async def prepare_turn(chat_id: str, text: str, page_id: str | None) -> dict | None:
    """Insert the user message and return everything the tutor call needs."""
    message_id = str(uuid4())
    async with await connect() as conn:
        async with conn.transaction():
            cur = await conn.execute(
                """
                SELECT c.id, c.title, c.project_id
                FROM chats c WHERE c.id = %s
                """,
                (chat_id,),
            )
            chat = await cur.fetchone()
            if chat is None:
                return None
            title = chat["title"]
            # Older rows may still say New session. Both rename on the first user turn.
            if title in {"Untitled chat", "New session"}:
                title = text.strip().split("\n", 1)[0][:80] or "Untitled chat"
                await conn.execute("UPDATE chats SET title = %s WHERE id = %s", (title, chat_id))
            await conn.execute(
                "INSERT INTO messages (id, chat_id, role, content) VALUES (%s, %s, 'user', %s)",
                (message_id, chat_id, text),
            )
            pages = await (
                await conn.execute(
                    """
                    SELECT id, project_id, parent_id, title, depth, position
                    FROM pages WHERE project_id = %s
                    ORDER BY depth, position
                    """,
                    (chat["project_id"],),
                )
            ).fetchall()
            blocks = await (
                await conn.execute(
                    """
                    SELECT b.id, b.page_id, b.position, b.type, b.payload, b.version
                    FROM blocks b JOIN pages p ON p.id = b.page_id
                    WHERE p.project_id = %s
                    ORDER BY b.position
                    """,
                    (chat["project_id"],),
                )
            ).fetchall()
            messages = await (
                await conn.execute(
                    """
                    SELECT role, content FROM messages
                    WHERE chat_id = %s ORDER BY created_at
                    """,
                    (chat_id,),
                )
            ).fetchall()
    chosen = page_id
    page_ids = {page["id"] for page in pages}
    if chosen not in page_ids:
        roots = [page for page in pages if page["parent_id"] is None]
        chosen = roots[0]["id"] if roots else None
    page_blocks = [block for block in blocks if block["page_id"] == chosen]
    return {
        "projectId": chat["project_id"],
        "chatTitle": title,
        "pageId": chosen,
        "pages": pages,
        "blocks": blocks,
        "pageBlocks": page_blocks,
        "history": messages,
    }


async def save_assistant(chat_id: str, content: str) -> str:
    message_id = str(uuid4())
    async with await connect() as conn:
        await conn.execute(
            "INSERT INTO messages (id, chat_id, role, content) VALUES (%s, %s, 'assistant', %s)",
            (message_id, chat_id, content),
        )
        await conn.commit()
    return message_id


async def store_apply(project_id: str, result: dict) -> None:
    touched = set(result["touchedPageIds"])
    async with await connect() as conn:
        async with conn.transaction():
            known = await (
                await conn.execute("SELECT id FROM pages WHERE project_id = %s", (project_id,))
            ).fetchall()
            known_ids = {row["id"] for row in known}
            new_pages = [page for page in result["pages"] if page["id"] not in known_ids]
            new_pages.sort(key=lambda page: page["depth"])
            for page in new_pages:
                await conn.execute(
                    """
                    INSERT INTO pages (id, project_id, parent_id, title, depth, position)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        page["id"],
                        project_id,
                        page["parent_id"],
                        page["title"],
                        page["depth"],
                        page["position"],
                    ),
                )
            for page_id in touched:
                await conn.execute("DELETE FROM blocks WHERE page_id = %s", (page_id,))
            for block in result["blocks"]:
                if block["page_id"] not in touched:
                    continue
                await conn.execute(
                    """
                    INSERT INTO blocks (id, page_id, position, type, payload, version)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        block["id"],
                        block["page_id"],
                        block["position"],
                        block["type"],
                        Json(block["payload"]),
                        block["version"],
                    ),
                )


async def update_block(block_id: str, version: int, payload: dict) -> dict | None | str:
    """Return the row, None if missing, or 'conflict' if the version does not match."""
    async with await connect() as conn:
        cur = await conn.execute("SELECT id, type, version FROM blocks WHERE id = %s", (block_id,))
        row = await cur.fetchone()
        if row is None:
            return None
        if row["version"] != version:
            return "conflict"
        updated = await conn.execute(
            """
            UPDATE blocks SET payload = %s, version = version + 1
            WHERE id = %s AND version = %s
            RETURNING id, page_id, position, type, payload, version
            """,
            (Json(payload), block_id, version),
        )
        saved = await updated.fetchone()
        await conn.commit()
        return saved


def _chat(row: dict) -> dict:
    return {"id": row["id"], "projectId": row["project_id"], "title": row["title"]}


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


async def sync_project_chunks(project_id: str, extras: list[tuple[str, str, str]] | None = None) -> None:
    """Rebuild block and user-message chunks. Leave assistant chunks unless asked.

    ponytail: full scan each turn. Fine for one student's notes. Upgrade is a dirty set
    when a project is large enough that this write shows up in the turn.
    """
    async with await connect() as conn:
        async with conn.transaction():
            blocks = await (
                await conn.execute(
                    """
                    SELECT b.id, b.type, b.payload, p.title
                    FROM blocks b
                    JOIN pages p ON p.id = b.page_id
                    WHERE p.project_id = %s
                    """,
                    (project_id,),
                )
            ).fetchall()
            users = await (
                await conn.execute(
                    """
                    SELECT m.id, m.content
                    FROM messages m
                    JOIN chats c ON c.id = m.chat_id
                    WHERE c.project_id = %s AND m.role = 'user'
                    """,
                    (project_id,),
                )
            ).fetchall()
            desired: list[dict] = []
            for block in blocks:
                desired.extend(
                    chunks_for_source(
                        "block",
                        block["id"],
                        block_source(block["type"], block["payload"]),
                        f"Page: {block['title']}",
                    )
                )
            for message in users:
                desired.extend(chunks_for_source("user_message", message["id"], message["content"], "Earlier question:"))
            for source_type, source_id, text in extras or []:
                if source_type != "assistant_message":
                    continue
                desired.extend(chunks_for_source(source_type, source_id, text, "Earlier answer:"))

            existing = await (
                await conn.execute(
                    """
                    SELECT id, source_type, source_id, chunk_index, content_hash
                    FROM chunks WHERE project_id = %s
                    """,
                    (project_id,),
                )
            ).fetchall()
            by_source: dict[tuple[str, str], list[dict]] = {}
            for row in existing:
                by_source.setdefault((row["source_type"], row["source_id"]), []).append(row)
            wanted: dict[tuple[str, str], list[dict]] = {}
            for row in desired:
                wanted.setdefault((row["source_type"], row["source_id"]), []).append(row)

            managed = {"block", "user_message"}
            for key, rows in by_source.items():
                if key[0] in managed and key not in wanted:
                    await conn.execute(
                        "DELETE FROM chunks WHERE project_id = %s AND source_type = %s AND source_id = %s",
                        (project_id, key[0], key[1]),
                    )
                    continue
                if key[0] == "assistant_message":
                    still = await conn.execute("SELECT 1 FROM messages WHERE id = %s", (key[1],))
                    if await still.fetchone() is None:
                        await conn.execute(
                            "DELETE FROM chunks WHERE project_id = %s AND source_type = %s AND source_id = %s",
                            (project_id, key[0], key[1]),
                        )

            for key, rows in wanted.items():
                old = sorted(by_source.get(key, []), key=lambda item: item["chunk_index"])
                same = len(old) == len(rows) and all(
                    old_row["chunk_index"] == new_row["chunk_index"] and old_row["content_hash"] == new_row["content_hash"]
                    for old_row, new_row in zip(old, rows)
                )
                if same:
                    continue
                await conn.execute(
                    "DELETE FROM chunks WHERE project_id = %s AND source_type = %s AND source_id = %s",
                    (project_id, key[0], key[1]),
                )
                for row in rows:
                    await conn.execute(
                        """
                        INSERT INTO chunks (id, project_id, source_type, source_id, chunk_index, content, content_hash)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            str(uuid4()),
                            project_id,
                            row["source_type"],
                            row["source_id"],
                            row["chunk_index"],
                            row["content"],
                            row["content_hash"],
                        ),
                    )


async def pending_embeddings(project_id: str, limit: int = 32) -> list[dict]:
    async with await connect() as conn:
        cur = await conn.execute(
            """
            SELECT id, content, content_hash FROM chunks
            WHERE project_id = %s AND embedding IS NULL
            LIMIT %s
            """,
            (project_id, limit),
        )
        return await cur.fetchall()


async def write_embeddings(pairs: list[tuple[str, str, list[float]]]) -> None:
    async with await connect() as conn:
        async with conn.transaction():
            for chunk_id, content_hash, vector in pairs:
                if len(vector) != EMBEDDING_DIM:
                    continue
                await conn.execute(
                    """
                    UPDATE chunks SET embedding = %s::vector
                    WHERE id = %s AND content_hash = %s
                    """,
                    (_vector_literal(vector), chunk_id, content_hash),
                )


async def search_chunks(project_id: str, query: str, embedding: list[float] | None) -> list[dict]:
    query = query.strip()
    if not query:
        return []
    async with await connect() as conn:
        lexical = await (
            await conn.execute(
                """
                SELECT id FROM chunks
                WHERE project_id = %s
                  AND tsv @@ websearch_to_tsquery('english', %s)
                ORDER BY ts_rank_cd(tsv, websearch_to_tsquery('english', %s)) DESC
                LIMIT 40
                """,
                (project_id, query, query),
            )
        ).fetchall()
        semantic_ids: list[str] = []
        if embedding and len(embedding) == EMBEDDING_DIM:
            semantic = await (
                await conn.execute(
                    """
                    SELECT id FROM chunks
                    WHERE project_id = %s AND embedding IS NOT NULL
                    ORDER BY embedding <=> %s::vector
                    LIMIT 40
                    """,
                    (project_id, _vector_literal(embedding)),
                )
            ).fetchall()
            semantic_ids = [row["id"] for row in semantic]
        ranked = rrf([[row["id"] for row in lexical], semantic_ids])[:8]
        if not ranked:
            return []
        rows = await (
            await conn.execute(
                """
                SELECT id, content, source_type FROM chunks
                WHERE project_id = %s AND id = ANY(%s)
                """,
                (project_id, ranked),
            )
        ).fetchall()
        by_id = {row["id"]: row for row in rows}
        return [by_id[item] for item in ranked if item in by_id]
