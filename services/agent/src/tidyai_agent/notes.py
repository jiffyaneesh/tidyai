"""Note prompts and block operations. No database.

ponytail: automatic page creates stop at depth 3. Lift that when a real subject
needs deeper auto-structure. History sent to the tutor is the last 20 messages,
and the current page text is capped at 12_000 characters.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable

from tidyai_agent.stream import complete_chat
from tidyai_agent.turn import BLOCK_TYPES, validate_note_op

MAX_OPS = 20
MAX_DEPTH = 3
_MAX_TEXT = 8_000
_PAGE_CAP = 12_000

STUDY_SYSTEM = (
    "You are a study tutor. Explain clearly in markdown. "
    "Use $$ for display math and $ for inline math. Do not emit HTML."
)

NOTE_SYSTEM = """You update study notes after a tutor answer. Return JSON only, no markdown fence.
Shape: {"ops":[{"op":"insert"|"replace"|"delete", ...}]}
insert needs parentId (a page id), type, and payload.
replace needs blockId, type, payload, and seenVersion.
delete needs blockId.
Allowed types: paragraph, heading, bulleted_list_item, numbered_list_item, to_do, equation, table, callout, toggle, divider, child_page.
paragraph, callout, toggle, and list items use {"text":"..."}.
heading uses {"text":"...","level":1|2|3}.
to_do uses {"text":"...","checked":false}.
equation uses {"latex":"..."}.
table uses {"rows":[["cell"]]}.
child_page uses {"title":"..."} and creates a page. Do not invent page or block ids.
Prefer replace when the answer corrects an existing block. Use at most 20 ops.
If the answer adds nothing worth keeping, return {"ops":[]}."""


def study_messages(history: list[dict], *, outline: str, page_text: str) -> list[dict]:
    system = (
        f"{STUDY_SYSTEM}\n\nProject outline:\n{outline[:_PAGE_CAP]}\n\n"
        f"Current page:\n{page_text[:_PAGE_CAP]}"
    )
    trimmed = history[-20:]
    return [{"role": "system", "content": system}, *trimmed]


def note_messages(*, outline: str, answer: str) -> list[dict]:
    return [
        {"role": "system", "content": NOTE_SYSTEM},
        {
            "role": "user",
            "content": (
                f"Outline:\n{outline[:_PAGE_CAP]}\n\nAnswer:\n{answer[:_PAGE_CAP]}\n\nReturn JSON."
            ),
        },
    ]


def repair_messages(bad: str) -> list[dict]:
    return [
        {"role": "system", "content": NOTE_SYSTEM},
        {
            "role": "user",
            "content": "That was not valid JSON. Return only the JSON object.\n\n" + bad[:4_000],
        },
    ]


def parse_ops_payload(text: str) -> list[dict]:
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end < start:
        raise ValueError("no json")
    data = json.loads(raw[start : end + 1])
    if not isinstance(data, dict) or not isinstance(data.get("ops"), list):
        raise ValueError("ops missing")
    return data["ops"]


def format_outline(pages: list[dict], blocks: list[dict]) -> str:
    by_page: dict[str, list[dict]] = {}
    for block in blocks:
        by_page.setdefault(block["page_id"], []).append(block)
    lines: list[str] = []
    for page in pages:
        lines.append(f'- page {page["id"]} depth {page["depth"]}: {page["title"]}')
        for block in by_page.get(page["id"], []):
            excerpt = _excerpt(block)[:160]
            lines.append(
                f'  - block {block["id"]} {block["type"]} v{block["version"]}: {excerpt}'
            )
    return "\n".join(lines)


def format_page(blocks: list[dict]) -> str:
    lines = []
    for block in blocks:
        lines.append(f'{block["type"]}: {_excerpt(block)}')
    return "\n".join(lines)


def _excerpt(block: dict) -> str:
    payload = block.get("payload") or {}
    if not isinstance(payload, dict):
        return ""
    if isinstance(payload.get("text"), str):
        return payload["text"]
    if isinstance(payload.get("latex"), str):
        return payload["latex"]
    if isinstance(payload.get("title"), str):
        return payload["title"]
    rows = payload.get("rows")
    if isinstance(rows, list):
        return " | ".join(str(cell) for row in rows[:2] if isinstance(row, list) for cell in row[:4])
    return ""


def clean_payload(block_type: str, payload: object) -> dict:
    if block_type not in BLOCK_TYPES:
        raise ValueError(f"unknown block type: {block_type!r}")
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    if block_type == "divider":
        return {}
    if block_type == "equation":
        return {"latex": _text(payload.get("latex"))}
    if block_type == "table":
        return {"rows": _rows(payload.get("rows"))}
    if block_type == "child_page":
        title = _text(payload.get("title"))
        if not title:
            raise ValueError("child page needs a title")
        cleaned = {"title": title}
        page_id = payload.get("pageId")
        if isinstance(page_id, str) and page_id:
            cleaned["pageId"] = page_id
        return cleaned
    text = _text(payload.get("text"))
    if block_type == "heading":
        level = payload.get("level", 2)
        if not isinstance(level, int) or isinstance(level, bool) or level not in {1, 2, 3}:
            level = 2
        return {"text": text, "level": level}
    if block_type == "to_do":
        return {"text": text, "checked": payload.get("checked") is True}
    return {"text": text}


def _text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value[:_MAX_TEXT]


def _rows(value: object) -> list[list[str]]:
    if not isinstance(value, list):
        raise ValueError("table rows must be a list")
    rows: list[list[str]] = []
    for row in value[:20]:
        if not isinstance(row, list):
            continue
        rows.append([_text(cell)[:500] for cell in row[:8]])
    if not rows:
        raise ValueError("table needs rows")
    return rows


def apply_note_ops(
    pages: list[dict],
    blocks: list[dict],
    ops: list[dict],
    *,
    project_id: str,
    new_id: Callable[[], str],
) -> dict:
    """Copy pages and blocks, apply up to 20 ops, skip the ones that do not fit."""
    next_pages = [dict(page) for page in pages]
    next_blocks = [dict(block) for block in blocks]
    pages_by_id = {page["id"]: page for page in next_pages}
    touched: list[str] = []
    skipped: list[str] = []

    def touch(page_id: str) -> None:
        if page_id not in touched:
            touched.append(page_id)

    for op in ops[:MAX_OPS]:
        if not isinstance(op, dict):
            skipped.append("ignored a note op that was not an object")
            continue
        try:
            validate_note_op(op)
            _apply_one(op, pages_by_id, next_pages, next_blocks, project_id, new_id, touch)
        except ValueError as exc:
            skipped.append(str(exc))
    if len(ops) > MAX_OPS:
        skipped.append("ignored note ops past the first 20")
    return {
        "pages": next_pages,
        "blocks": next_blocks,
        "touchedPageIds": touched,
        "skipped": skipped,
    }


def _apply_one(op, pages_by_id, pages, blocks, project_id, new_id, touch) -> None:
    kind = op["op"]
    if kind == "delete":
        block = _find(blocks, op["blockId"])
        if block is None:
            raise ValueError("delete missed the block")
        blocks.remove(block)
        touch(block["page_id"])
        return
    payload = clean_payload(op["type"], op.get("payload"))
    if kind == "replace":
        block = _find(blocks, op["blockId"])
        if block is None:
            raise ValueError("replace missed the block")
        seen = op.get("seenVersion")
        if isinstance(seen, int) and not isinstance(seen, bool) and seen != block["version"]:
            raise ValueError("block changed since the outline was read")
        if op["type"] == "child_page" and block["type"] != "child_page":
            raise ValueError("cannot turn a block into a page reference")
        block["type"] = op["type"]
        block["payload"] = payload
        block["version"] = block["version"] + 1
        touch(block["page_id"])
        return
    parent = pages_by_id.get(op["parentId"])
    if parent is None:
        raise ValueError("insert parent is not a page")
    if op["type"] == "child_page":
        if parent["depth"] + 1 > MAX_DEPTH:
            raise ValueError("page is already nested 3 deep")
        page_id = payload.get("pageId")
        if page_id is None:
            page_id = new_id()
            position = _next_position(pages, parent["id"])
            page = {
                "id": page_id,
                "project_id": project_id,
                "parent_id": parent["id"],
                "title": payload["title"],
                "depth": parent["depth"] + 1,
                "position": position,
            }
            pages.append(page)
            pages_by_id[page_id] = page
            touch(page_id)
        elif page_id not in pages_by_id:
            raise ValueError("child page does not exist")
        payload = {"title": payload["title"], "pageId": page_id}
    block_id = new_id()
    position = _next_position(blocks, parent["id"], page_key="page_id")
    blocks.append(
        {
            "id": block_id,
            "page_id": parent["id"],
            "position": position,
            "type": op["type"],
            "payload": payload,
            "version": 1,
        }
    )
    touch(parent["id"])


def _find(blocks: list[dict], block_id: str) -> dict | None:
    for block in blocks:
        if block["id"] == block_id:
            return block
    return None


def _next_position(rows: list[dict], parent_id: str, page_key: str = "parent_id") -> int:
    positions = [row["position"] for row in rows if row.get(page_key) == parent_id]
    return (max(positions) + 1) if positions else 0


async def note_ops_from_answer(*, outline: str, answer: str, **provider) -> tuple[list[dict], str | None]:
    """Return ops. The second value is a safe status when parsing fails."""
    text = await complete_chat(messages=note_messages(outline=outline, answer=answer), **provider)
    try:
        return parse_ops_payload(text), None
    except (ValueError, json.JSONDecodeError):
        pass
    repaired = await complete_chat(messages=repair_messages(text), **provider)
    try:
        return parse_ops_payload(repaired), None
    except (ValueError, json.JSONDecodeError):
        return [], "Notes not updated."
