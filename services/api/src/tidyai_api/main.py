"""HTTP boundary. Transactions live here. Provider keys are read and forgotten."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from psycopg import OperationalError
from pydantic import BaseModel, Field

from tidyai_agent.notes import (
    apply_note_ops,
    clean_payload,
    format_outline,
    format_page,
    note_ops_from_answer,
    study_messages,
)
from tidyai_agent.retrieve import (
    SEARCH_TOOLS,
    TOOL_HINT,
    ToolAssembler,
    ToolCall,
    append_tool_results,
    format_hits,
)
from tidyai_agent.stream import (
    PROTOCOLS,
    ProviderError,
    check_base_url,
    check_model,
    embed_texts,
    stream_chat,
)
from tidyai_agent.turn import route_turn
from tidyai_api import db


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db_ok = False
    try:
        await db.init_schema()
        app.state.db_ok = True
    except OperationalError:
        app.state.db_ok = False
    yield


app = FastAPI(title="tidyai", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["Content-Type", "X-Provider-Key", "X-Embedding-Key"],
)


class ProjectIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class ChatIn(BaseModel):
    title: str = Field(default="Untitled chat", min_length=1, max_length=200)


class TurnIn(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)
    protocol: Literal["openai_chat", "gemini"]
    baseUrl: str
    model: str
    patchModel: str | None = None
    pageId: str | None = None
    embeddingModel: str | None = None
    embeddingBaseUrl: str | None = None
    mode: Literal["notes", "web"] = "web"


class BlockIn(BaseModel):
    version: int
    payload: dict


class PageBlockIn(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    type: str = Field(min_length=1, max_length=64)
    payload: dict = Field(default_factory=dict)


class PageBlocksIn(BaseModel):
    blocks: list[PageBlockIn] = Field(default_factory=list, max_length=500)


def sse(event: str, data: str) -> str:
    lines = "".join(f"data: {line}\n" for line in data.split("\n"))
    return f"event: {event}\n{lines}\n"


def block_out(row: dict) -> dict:
    return {
        "id": row["id"],
        "pageId": row["page_id"],
        "position": row["position"],
        "type": row["type"],
        "payload": row["payload"],
        "version": row["version"],
    }


def page_out(row: dict, blocks: list[dict] | None = None) -> dict:
    data = {
        "id": row["id"],
        "parentId": row["parent_id"],
        "title": row["title"],
        "depth": row["depth"],
        "position": row["position"],
    }
    if blocks is not None:
        data["blocks"] = [block_out(block) for block in blocks]
    return data


def db_down() -> JSONResponse:
    return JSONResponse(
        {"code": "db_down", "message": "Database is not running."},
        status_code=503,
    )


@app.get("/health")
async def health() -> dict[str, str]:
    if not app.state.db_ok:
        return {"status": "ok", "db": "down"}
    try:
        async with await db.connect() as conn:
            await conn.execute("SELECT 1")
        return {"status": "ok", "db": "ok"}
    except OperationalError:
        return {"status": "ok", "db": "down"}


@app.get("/v1/projects")
async def projects():
    try:
        return await db.list_projects()
    except OperationalError:
        return db_down()


@app.post("/v1/projects", status_code=201)
async def create_project(body: ProjectIn):
    try:
        return await db.create_project(body.title.strip())
    except OperationalError:
        return db_down()


@app.get("/v1/projects/{project_id}/chats")
async def chats(project_id: str):
    try:
        rows = await db.list_chats(project_id)
    except OperationalError:
        return db_down()
    return rows


@app.post("/v1/projects/{project_id}/chats", status_code=201)
async def create_chat(project_id: str, body: ChatIn):
    try:
        chat = await db.create_chat(project_id, body.title.strip())
    except OperationalError:
        return db_down()
    if chat is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return chat


@app.get("/v1/chats/{chat_id}/messages")
async def messages(chat_id: str):
    try:
        rows = await db.list_messages(chat_id)
    except OperationalError:
        return db_down()
    if rows is None:
        raise HTTPException(status_code=404, detail="Chat not found.")
    return rows


@app.get("/v1/projects/{project_id}/pages")
async def pages(project_id: str):
    try:
        rows = await db.list_pages(project_id)
    except OperationalError:
        return db_down()
    if rows is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return [page_out(row) for row in rows]


@app.get("/v1/projects/{project_id}/pages/{page_id}")
async def page(project_id: str, page_id: str):
    try:
        row = await db.get_page(project_id, page_id)
    except OperationalError:
        return db_down()
    if row is None:
        raise HTTPException(status_code=404, detail="Page not found.")
    return page_out(row, row["blocks"])


@app.patch("/v1/blocks/{block_id}")
async def patch_block(block_id: str, body: BlockIn):
    try:
        async with await db.connect() as conn:
            cur = await conn.execute("SELECT type FROM blocks WHERE id = %s", (block_id,))
            row = await cur.fetchone()
    except OperationalError:
        return db_down()
    if row is None:
        raise HTTPException(status_code=404, detail="Block not found.")
    try:
        payload = clean_payload(row["type"], body.payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    try:
        saved = await db.update_block(block_id, body.version, payload)
    except OperationalError:
        return db_down()
    if saved is None:
        raise HTTPException(status_code=404, detail="Block not found.")
    if saved == "conflict":
        return JSONResponse(
            {"code": "conflict", "message": "This block changed. Reload it."},
            status_code=409,
        )
    return block_out(saved)


@app.put("/v1/projects/{project_id}/pages/{page_id}/blocks")
async def put_page_blocks(project_id: str, page_id: str, body: PageBlocksIn):
    cleaned: list[dict] = []
    seen: set[str] = set()
    for item in body.blocks:
        if item.id in seen:
            raise HTTPException(status_code=400, detail="Duplicate block id.")
        seen.add(item.id)
        try:
            payload = clean_payload(item.type, item.payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        cleaned.append({"id": item.id, "type": item.type, "payload": payload})
    try:
        saved = await db.replace_page_blocks(project_id, page_id, cleaned)
        if saved is not None:
            await db.sync_project_chunks(project_id)
    except OperationalError:
        return db_down()
    if saved is None:
        raise HTTPException(status_code=404, detail="Page not found.")
    return [block_out(row) for row in saved]


@app.post("/v1/chats/{chat_id}/turns")
async def create_turn(
    chat_id: str,
    body: TurnIn,
    request: Request,
    x_provider_key: str | None = Header(default=None, alias="X-Provider-Key"),
    x_embedding_key: str | None = Header(default=None, alias="X-Embedding-Key"),
):
    if body.protocol not in PROTOCOLS:
        return JSONResponse(
            {"code": "bad_protocol", "message": "Protocol must be openai_chat or gemini."},
            status_code=400,
        )
    if not x_provider_key or not x_provider_key.strip():
        return JSONResponse(
            {"code": "missing_key", "message": "Add a provider key in settings."},
            status_code=401,
        )
    try:
        base = check_base_url(body.baseUrl)
        model = check_model(body.model)
        patch_model = check_model(body.patchModel) if body.patchModel else model
    except ProviderError as exc:
        return JSONResponse({"code": exc.code, "message": exc.message}, status_code=400)
    try:
        prepared = await db.prepare_turn(chat_id, body.text, body.pageId)
    except OperationalError:
        return db_down()
    if prepared is None:
        raise HTTPException(status_code=404, detail="Chat not found.")

    provider = {
        "protocol": body.protocol,
        "base_url": base,
        "api_key": x_provider_key.strip(),
        "model": model,
    }
    history = [{"role": row["role"], "content": row["content"]} for row in prepared["history"]]
    outline = format_outline(prepared["pages"], prepared["blocks"])
    page_text = format_page(prepared["pageBlocks"])
    messages = study_messages(history, outline=outline, page_text=page_text)
    mode = body.mode
    if messages and messages[0].get("role") == "system":
        if mode == "notes":
            messages[0] = {
                **messages[0],
                "content": messages[0]["content"]
                + TOOL_HINT
                + "\n\nMode: notes. Answer only from the outline, current page, and search_notes. Do not invent outside facts. Do not propose note edits.",
            }
        else:
            messages[0] = {
                **messages[0],
                "content": messages[0]["content"]
                + "\n\nMode: web. Use provider web search when the question needs current or outside facts. The session will update study notes after your answer.",
            }
    embed = _embedding_config(body, base, provider["api_key"], x_embedding_key)

    async def events():
        try:
            await db.sync_project_chunks(prepared["projectId"])
            if embed:
                await _embed_pending(prepared["projectId"], embed)
        except (OperationalError, ProviderError):
            pass

        chunks: list[str] = []
        disconnected = False
        live = messages
        if mode == "web":
            try:
                async for piece in stream_chat(
                    messages=live,
                    tools=None,
                    web_search=True,
                    **provider,
                ):
                    if await request.is_disconnected():
                        disconnected = True
                        break
                    chunks.append(piece)
                    yield sse("text", piece)
            except ProviderError as exc:
                text = "".join(chunks)
                if text:
                    await _save_quiet(chat_id, text)
                message = exc.message
                if exc.code == "upstream":
                    message = (
                        f"{exc.message} Web mode needs a host that supports provider web search "
                        "(OpenAI search-capable Chat Completions, or Gemini). Or switch to Notes mode."
                    )
                yield sse("error", json.dumps({"code": exc.code, "message": message}))
                yield sse("done", "{}")
                return
        else:
            route = route_turn(
                body.text,
                project_has_notes=bool(prepared["blocks"]),
            )
            # P3: memory / multi-note cues force one search before the model speaks.
            if route.name in {"retrieve", "agentic"}:
                yield sse("status", "Searching notes")
                forced = ToolCall(
                    id="forced_search",
                    name="search_notes",
                    arguments=json.dumps({"query": body.text}),
                )
                result, citations = await _run_search(prepared["projectId"], forced.arguments, embed)
                if citations:
                    yield sse("citations", json.dumps(citations))
                live = append_tool_results(live, [forced], [result])
            for round_index in range(3):
                assembler = ToolAssembler()
                use_tools = round_index < 2
                try:
                    async for piece in stream_chat(
                        messages=live,
                        tools=SEARCH_TOOLS if use_tools else None,
                        assembler=assembler,
                        **provider,
                    ):
                        if await request.is_disconnected():
                            disconnected = True
                            break
                        chunks.append(piece)
                        yield sse("text", piece)
                except ProviderError as exc:
                    text = "".join(chunks)
                    if text:
                        await _save_quiet(chat_id, text)
                    yield sse("error", json.dumps({"code": exc.code, "message": exc.message}))
                    yield sse("done", "{}")
                    return
                if disconnected:
                    break
                calls = [call for call in assembler.calls() if call.name == "search_notes"][:1]
                if not calls or not use_tools:
                    break
                yield sse("status", "Searching notes")
                packed = [await _run_search(prepared["projectId"], call.arguments, embed) for call in calls]
                results = [item[0] for item in packed]
                citations = [hit for item in packed for hit in item[1]]
                if citations:
                    yield sse("citations", json.dumps(citations))
                live = append_tool_results(live, calls, results)

        text = "".join(chunks)
        if disconnected:
            if text:
                await _save_quiet(chat_id, text)
            yield sse("done", "{}")
            return
        message_id = ""
        if text:
            try:
                message_id = await db.save_assistant(chat_id, text)
            except OperationalError:
                yield sse("error", json.dumps({"code": "db_down", "message": "Database is not running."}))
                yield sse("done", "{}")
                return
        if not text:
            yield sse(
                "error",
                json.dumps({"code": "empty", "message": "Provider returned an empty answer."}),
            )
            yield sse("done", "{}")
            return

        # B1: notes mode is pure Q&A — never mutate the block tree.
        if mode == "notes":
            yield sse("done", "{}")
            return

        yield sse("status", "Updating notes")
        try:
            ops, failure = await note_ops_from_answer(
                outline=outline,
                answer=text,
                protocol=body.protocol,
                base_url=base,
                api_key=provider["api_key"],
                model=patch_model,
            )
        except ProviderError as exc:
            await _keep_answer(prepared["projectId"], message_id, text)
            yield sse("status", f"Notes not updated. {exc.message}")
            yield sse("done", "{}")
            return
        if failure:
            await _keep_answer(prepared["projectId"], message_id, text)
            yield sse("status", failure)
            yield sse("done", "{}")
            return
        result = apply_note_ops(
            prepared["pages"],
            prepared["blocks"],
            ops,
            project_id=prepared["projectId"],
            new_id=lambda: str(uuid4()),
        )
        try:
            await db.store_apply(prepared["projectId"], result)
            await db.sync_project_chunks(prepared["projectId"])
        except OperationalError:
            await _keep_answer(prepared["projectId"], message_id, text)
            yield sse("status", "Notes not updated. Database is not running.")
            yield sse("done", "{}")
            return
        yield sse("notes", json.dumps(result["touchedPageIds"]))
        if result["skipped"]:
            yield sse("status", "Some note updates were skipped.")
        yield sse("done", "{}")

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _embedding_config(body: TurnIn, chat_base: str, chat_key: str, embedding_key: str | None) -> dict | None:
    model = (body.embeddingModel or "").strip()
    if not model:
        return None
    try:
        model = check_model(model)
        raw_base = (body.embeddingBaseUrl or "").strip()
        base = check_base_url(raw_base) if raw_base else chat_base
    except ProviderError:
        return None
    return {
        "protocol": body.protocol,
        "base_url": base,
        "api_key": (embedding_key or "").strip() or chat_key,
        "model": model,
    }


async def _embed_pending(project_id: str, embed: dict) -> None:
    pending = await db.pending_embeddings(project_id, limit=32)
    if not pending:
        return
    vectors = await embed_texts(texts=[row["content"] for row in pending], **embed)
    pairs = [
        (row["id"], row["content_hash"], vector)
        for row, vector in zip(pending, vectors)
        if vector
    ]
    if pairs:
        await db.write_embeddings(pairs)


async def _run_search(
    project_id: str, arguments: str, embed: dict | None
) -> tuple[str, list[dict]]:
    try:
        payload = json.loads(arguments) if arguments else {}
    except json.JSONDecodeError:
        payload = {"query": arguments}
    if not isinstance(payload, dict):
        payload = {"query": str(payload)}
    query = str(payload.get("query") or "").strip()
    if not query:
        return "No query.", []
    vector = None
    if embed:
        try:
            vectors = await embed_texts(texts=[query], **embed)
            vector = vectors[0] if vectors else None
        except ProviderError:
            vector = None
    try:
        hits = await db.search_chunks(project_id, query, vector)
    except OperationalError:
        return "Search failed because the database is not running.", []
    citations = [
        {
            "sourceType": hit.get("source_type"),
            "sourceId": hit.get("source_id"),
            "snippet": str(hit.get("content") or "").replace("\n", " ")[:140],
        }
        for hit in hits
    ]
    return format_hits(hits), citations


async def _keep_answer(project_id: str, message_id: str, text: str) -> None:
    if not message_id:
        return
    try:
        await db.sync_project_chunks(project_id, extras=[("assistant_message", message_id, text)])
    except OperationalError:
        return


async def _save_quiet(chat_id: str, text: str) -> None:
    try:
        await db.save_assistant(chat_id, text)
    except OperationalError:
        return
