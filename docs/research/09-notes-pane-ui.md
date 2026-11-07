# 09 — Notes pane UI

Question: the right pane feels like a dump of text. How close to Notion/Obsidian do we go without reopening the block store.

## Short decision

**Partially superseded (2026-11-07).** Resize + typed `BlockView` polish still stand. The "no BlockNote/TipTap" call is overturned in [10-notes-editor-engine.md](10-notes-editor-engine.md) after notebook-feel feedback. Keep this file for the resize and "no quote type" decisions.

Original (kept for history): polish the existing block tree. Do not replace it with TipTap, BlockNote, or a markdown file.

1. **Render every allowed type as its own component** (heading levels, lists, callout, toggle, equation, table, divider, child page). The agent already emits these; the web UI mostly painted them as `<p>`.
2. **Resize the notes column with a drag handle.** Persist width in `localStorage`. Clamp. Default stays 360px. Under 960px the pane stays an overlay; drag still works on the overlay width.
3. **No new block type for "quote".** `callout` is the study equivalent. Style it with a quote affordance. Adding `quote` would fork the agent allowlist for cosmetics.
4. **No ProseMirror document.** Research in [02](02-render-engine.md) and [03](03-notes-sessions-flashcards.md) already locked typed blocks + model ops. TipTap as the page owner fights `insert`/`replace`/`delete` and stable ids. Industry write-ups that start with TipTap-as-document often end on a hybrid: React owns the block list, TipTap only owns inline marks inside one field. We skip even that for v1: plain text payloads, click-to-edit, KaTeX for equations.

## Options rejected

| Option | Why it lost |
| --- | --- |
| TipTap / BlockNote / @open-notion/editor as the page | New schema, new sync, model ops become a second writer against a ProseMirror doc. Bundle and slash-menu cost for a BYOK study pane. |
| Store notes as markdown like Obsidian | Overturns [03](03-notes-sessions-flashcards.md). Whole-doc rewrites, no stable ids. |
| New dependency for resize (`react-resizable-panels`, etc.) | A pointer-capture handle is ~40 lines. Ask before adding a package. |
| Collaborative cursors / CRDT | Still one human + one model turn. |

## Evidence

- Notion's public model is typed blocks with per-block update. That is already our store. Source: Notion data APIs, cited in [03](03-notes-sessions-flashcards.md).
- Teams that tried TipTap for the whole page and then needed typed, conditional, multi-field blocks moved the block list back to React and kept TipTap only for inline rich text. Source: Coder Legion block-email write-up (2025 industry pattern, medium confidence as advice for our app).
- Resize UIs that feel solid use pointer capture on a thin handle, min/max clamp, and persisted width. Source: common panel patterns / `@kors/use-resizable` shape. We copy the shape, not the package.

## What would change this

- Users need bold/italic/links inside a single paragraph and keep complaining after click-to-edit. Then TipTap (or similar) **inside** `paragraph` / `callout` payloads only. Storage stays `{text}` or a small marks array. The page is still our block list.
- Users need real nested list indent as first-class tree children. Then extend the block schema; do not fake it with spaces in `text`.
- A second simultaneous human editor. Then reopen CRDT, still not TipTap-as-store by default.
- **Fired:** pane still feels like textarea + Save after 09 polish. → [10-notes-editor-engine.md](10-notes-editor-engine.md) (BlockNote engine, Postgres blocks remain SoT).
