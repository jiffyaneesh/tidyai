"""Route a study turn and decide what may happen to notes and cards.

The lexical router is biased toward ``direct``. A false agentic label spends
a retrieval loop. A false direct label is a weaker answer the user can rephrase.

ponytail: cue lists miss paraphrases ("what was that torque thing"). Ceiling is
obvious keywords. Upgrade is a classifier once stored route labels show misses.
"""

from __future__ import annotations

from dataclasses import dataclass

BLOCK_TYPES = frozenset(
    {
        "paragraph",
        "heading",
        "bulleted_list_item",
        "numbered_list_item",
        "to_do",
        "equation",
        "table",
        "callout",
        "toggle",
        "divider",
        "child_page",
    }
)

# At or above this cosine, do not create. Ask the judge to update or skip.
# Below it, create. 0.92 is a starting threshold, not a measured optimum.
SAME_CONCEPT_COSINE = 0.92

_MEMORY_CUES = (
    "earlier",
    "my notes",
    "we covered",
    "last session",
    "previous session",
    "from the notes",
    "remind me",
)

_AGENTIC_CUES = (
    "compare ",
    "synthesize",
    "relationship between",
    "how does this connect",
    "across these",
    "across the notes",
)


@dataclass(frozen=True)
class Route:
    name: str
    reason: str


def route_turn(user_text: str, *, project_has_notes: bool) -> Route:
    """Pick direct, retrieve, or agentic. See docs/research/04-retrieval-byok-cost.md."""
    if not project_has_notes:
        return Route("direct", "no notes to retrieve")
    text = user_text.lower()
    if any(cue in text for cue in _AGENTIC_CUES):
        return Route("agentic", "multi-note cue")
    if any(cue in text for cue in _MEMORY_CUES):
        return Route("retrieve", "memory cue")
    return Route("direct", "outline and current page only")


def card_action(*, exact_key: bool, top_cosine: float | None) -> str:
    """Return ``judge_update`` or ``create``. Never deletes. Never skips here.

    Skip is the judge's job, and only after a candidate exists. Missing
    embeddings (``top_cosine is None``) degrade to exact key match.
    """
    if exact_key:
        return "judge_update"
    if top_cosine is not None and top_cosine >= SAME_CONCEPT_COSINE:
        return "judge_update"
    return "create"


def validate_note_op(op: dict) -> None:
    """Reject ops the notes pane cannot render. Raises ValueError."""
    kind = op.get("op")
    if kind not in {"insert", "replace", "delete"}:
        raise ValueError(f"unknown op: {kind!r}")
    if kind == "delete":
        if not op.get("blockId"):
            raise ValueError("delete requires blockId")
        return
    block_type = op.get("type")
    if block_type not in BLOCK_TYPES:
        raise ValueError(f"unknown block type: {block_type!r}")
    if kind == "replace" and not op.get("blockId"):
        raise ValueError("replace requires blockId")
    if kind == "insert" and not op.get("parentId"):
        raise ValueError("insert requires parentId")
