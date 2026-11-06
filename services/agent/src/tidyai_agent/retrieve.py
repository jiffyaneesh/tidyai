"""Chunking, rank fusion, and the one search tool. No database and no HTTP."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

# ponytail: 1536 matches text-embedding-3-small and Gemini outputDimensionality.
# A model that cannot emit 1536 stays lexical-only. Upgrade is a second column, not a guess.
EMBEDDING_DIM = 1536
RRF_K = 60
# ponytail: characters, not tokens. About 1000 tokens. A tokenizer is the upgrade if formulas split badly.
MAX_CHUNK = 4000
MAX_PARTS = 8

SEARCH_NOTES = {
    "name": "search_notes",
    "description": (
        "Search this subject's notes and the user's earlier questions. "
        "Use it when the current page does not contain the fact. Skip it when the current page is enough."
    ),
    "parameters": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    },
}
SEARCH_TOOLS = [SEARCH_NOTES]
TOOL_HINT = (
    "\n\nYou may call search_notes when the current page does not contain the fact. "
    "Skip it when the current page is enough. Do not invent a tool result."
)


def chunk_text(text: str, prefix: str = "") -> list[str]:
    body = text.strip()
    if not body:
        return []
    head = prefix.strip()

    def pack(piece: str) -> str:
        return f"{head}\n{piece}" if head else piece

    if len(pack(body)) <= MAX_CHUNK:
        return [pack(body)]
    parts: list[str] = []
    start = 0
    while start < len(body) and len(parts) < MAX_PARTS:
        parts.append(pack(body[start : start + MAX_CHUNK]))
        start += MAX_CHUNK
    return parts


def block_source(block_type: str, payload: dict) -> str:
    if not isinstance(payload, dict):
        return ""
    if block_type == "equation":
        return str(payload.get("latex") or "")
    if block_type == "child_page":
        return str(payload.get("title") or "")
    if block_type == "table":
        rows = payload.get("rows")
        if isinstance(rows, list):
            lines = []
            for row in rows:
                if isinstance(row, list):
                    lines.append(" | ".join(str(cell) for cell in row))
                else:
                    lines.append(str(row))
            return "\n".join(lines)
        return str(payload.get("text") or "")
    return str(payload.get("text") or "")


def chunks_for_source(source_type: str, source_id: str, text: str, prefix: str) -> list[dict]:
    rows = []
    for index, content in enumerate(chunk_text(text, prefix)):
        rows.append(
            {
                "source_type": source_type,
                "source_id": source_id,
                "chunk_index": index,
                "content": content,
                "content_hash": hashlib.sha256(content.encode()).hexdigest(),
            }
        )
    return rows


def rrf(lists: list[list[str]], k: int = RRF_K) -> list[str]:
    """Reciprocal rank fusion. Rank 1 is the best hit. Higher fused score wins."""
    scores: dict[str, float] = {}
    for ids in lists:
        for rank, item in enumerate(ids, start=1):
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=lambda item: scores[item], reverse=True)


def format_hits(hits: list[dict]) -> str:
    if not hits:
        return "No matching notes."
    lines = [f"[{hit.get('source_type', 'note')}] {hit.get('content', '')}" for hit in hits]
    return "\n\n".join(lines)[:8000]


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str


class ToolAssembler:
    """Collect streamed tool-call fragments. One instance per model round."""

    def __init__(self) -> None:
        self._slots: dict[int, dict[str, str]] = {}

    def feed(self, protocol: str, payload: dict) -> None:
        if protocol == "openai_chat":
            self._feed_openai(payload)
        elif protocol == "gemini":
            self._feed_gemini(payload)

    def calls(self) -> list[ToolCall]:
        found = []
        for index in sorted(self._slots):
            slot = self._slots[index]
            name = slot.get("name") or ""
            if not name:
                continue
            found.append(ToolCall(slot.get("id") or f"call_{index}", name, slot.get("arguments") or ""))
        return found

    def _feed_openai(self, payload: dict) -> None:
        choices = payload.get("choices") or []
        if not choices or not isinstance(choices[0], dict):
            return
        choice = choices[0]
        containers = []
        delta = choice.get("delta")
        if isinstance(delta, dict):
            containers.append(delta.get("tool_calls"))
        message = choice.get("message")
        if isinstance(message, dict):
            containers.append(message.get("tool_calls"))
        for calls in containers:
            if not isinstance(calls, list):
                continue
            for call in calls:
                if not isinstance(call, dict):
                    continue
                index = call.get("index", 0)
                if not isinstance(index, int):
                    index = 0
                slot = self._slots.setdefault(index, {"id": "", "name": "", "arguments": ""})
                if call.get("id"):
                    slot["id"] = str(call["id"])
                function = call.get("function") or {}
                if isinstance(function, dict):
                    if function.get("name"):
                        slot["name"] = str(function["name"])
                    if function.get("arguments"):
                        slot["arguments"] += str(function["arguments"])

    def _feed_gemini(self, payload: dict) -> None:
        candidates = payload.get("candidates") or []
        if not candidates or not isinstance(candidates[0], dict):
            return
        parts = ((candidates[0].get("content") or {}).get("parts") or [])
        found: dict[int, dict[str, str]] = {}
        index = 0
        for part in parts:
            if not isinstance(part, dict):
                continue
            call = part.get("functionCall")
            if not isinstance(call, dict) or not call.get("name"):
                continue
            args = call.get("args") or {}
            found[index] = {
                "id": str(call["name"]),
                "name": str(call["name"]),
                "arguments": json.dumps(args) if not isinstance(args, str) else args,
            }
            index += 1
        if found:
            self._slots = found


def append_tool_results(messages: list[dict], calls: list[ToolCall], results: list[str]) -> list[dict]:
    tool_calls = [
        {
            "id": call.id,
            "type": "function",
            "function": {"name": call.name, "arguments": call.arguments or "{}"},
        }
        for call in calls
    ]
    follow: list[dict] = [{"role": "assistant", "content": "", "tool_calls": tool_calls}]
    for call, result in zip(calls, results):
        follow.append(
            {
                "role": "tool",
                "tool_call_id": call.id,
                "name": call.name,
                "content": result,
            }
        )
    return [*messages, *follow]
