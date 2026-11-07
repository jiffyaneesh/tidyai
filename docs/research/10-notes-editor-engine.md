# 10 — Notes editor engine

Question: the notes pane still feels like a form (click → textarea → Save). What notebook engine gets Notion/Obsidian-class writing without throwing away the typed block store the agent writes into.

Date: 2026-11-07. This file **overturns** the TipTap/BlockNote rejection in [09-notes-pane-ui.md](09-notes-pane-ui.md). The falsifier named there fired: users still experience the pane as basic inputs, not a notebook. Resize and prettier `BlockView` did not close the gap. Evidence: product feedback after shipping 09.

## Short decision

Add a **notes editor engine** in `apps/web`: BlockNote (ProseMirror under the hood) as the writing surface. Postgres typed blocks stay the source of truth. The agent keep emitting `insert` / `replace` / `delete` against that store. A mapper bridges both sides. Human edits autosave (debounce + blur). No Save button.

Do **not** store the page as one markdown blob (Obsidian vault shape). Do **not** make BlockNote JSON the database of record. Do **not** put TipTap/BlockNote inside the agent package.

## What "engine" means here

| Layer | Owns | Must not |
| --- | --- | --- |
| BlockNote (+ thin React shell) | Cursor, slash menu, drag reorder, headings/lists/tables UI, inline marks, local undo | SQL, provider keys, note-op prompts |
| Mapper (`tidyai ↔ BlockNote`) | Ids, types, payloads, ordered list diffs | UI chrome |
| API + `schema.sql` | Durable pages/blocks, chunk refresh after human write | Editor DOM |
| Agent | Model note ops against the same block types | Importing BlockNote |

Chat stays Streamdown ([02](02-render-engine.md)). Notes get a real editor. Two renderers, one durable block schema — same split as before, with the notes side upgraded from "read + textarea" to "notebook".

## Notion vs Obsidian (product shape)

| Product | Storage | Edit UX | Fit for tidyai |
| --- | --- | --- | --- |
| Notion | Typed blocks, per-block update | Slash, drag, no Save | **Match.** Our store already looks like this ([03](03-notes-sessions-flashcards.md)). |
| Obsidian | Markdown files on disk | Live preview / source, wiki links, plugins | Wrong SoT for model ops. Whole-file rewrite. We can steal UX cues (live write, keyboard first), not the file model. |

Confidence that Notion's public block API is typed objects with update-by-id: **high** (official docs, already cited in 03). Confidence that "feel like Obsidian" means markdown-on-disk for us: **low** — users usually mean fluid typing, not `.md` files.

## Editor candidates (2026)

| Candidate | License (core) | Notion UX out of the box | Schema fit | Verdict |
| --- | --- | --- | --- | --- |
| **BlockNote** | MPL-2.0 (XL export packs GPL/commercial — we skip XL) | Slash, side menu, drag, nesting | Block array with stable `id`, custom blocks documented | **Pick.** Fastest path to notebook UX in React. |
| TipTap alone | MIT | Build slash/drag yourself (or paid templates) | ProseMirror JSON; we design nodes | Engine only. More UI work for the same end state BlockNote already ships. |
| Plate | MIT (+ paid Plus) | Copy shadcn-style kits | Slate JSON | Fine if we want to own UI source; more assembly. |
| Lexical | MIT | Headless — we build everything | Own state model | Reject for this slice. Too much editor R&D. |
| Milkdown / Quoin | MIT | Markdown-first | Markdown / remark | Pulls toward Obsidian file shape. Reject as SoT. |
| Homegrown contenteditable | — | None | Our types | Already failed the feel test. |

Sources: BlockNote format docs (JSON lossless; HTML/Markdown lossy), TipTap-vs-BlockNote comparisons (BlockNote = TipTap + Notion UI), Domternal 2026 alternatives table. Confidence in "BlockNote is the shortest Notion-like path in React": **medium-high**. Confidence in long-term 0.x API stability: **medium** (still pre-1.0).

## Mapping (the hard part)

Our allowlist today: `paragraph`, `heading`, `bulleted_list_item`, `numbered_list_item`, `to_do`, `equation`, `table`, `callout`, `toggle`, `divider`, `child_page`.

BlockNote defaults cover paragraph, heading, lists, check list, table, etc. Gaps need **custom BlockNote blocks** (supported): `equation` (KaTeX), `callout`, `toggle`, `child_page`, `divider` if missing.

Rules:

1. **Preserve our block `id`.** Pass through as BlockNote `id` on load. Human inserts get new UUIDs client-side before save.
2. **Plain text first for inline.** v1 mapper flattens BlockNote inline marks to a single `text` string (and `latex` / `rows` where typed). Bold/italic can round-trip later via a marks array in payload; do not block shipping on marks.
3. **Tables** stay `payload.rows` on our side. Map to/from BlockNote table cells on load/save.
4. **Unknown BlockNote types** (image, video, …) → strip or convert to paragraph on save. Do not widen the agent allowlist by accident.
5. **Model write while editing.** On SSE `notes` for the open page: if local dirty, keep local and show a non-blocking "Session updated notes — Reload" affordance. If clean, replace editor document from refetch. Do not merge token soup into the cursor.

## Autosave (no Save button)

1. `onChange` → debounce ~400–600ms.
2. Flush also on blur / page hide / page switch.
3. Persist via a new **page replace** route (below), not N× `PATCH` only. Slash insert + drag reorder make per-block patch + client diff fragile.
4. UI: quiet "Saving…" / "Saved" in the notes header. Never a primary Save button.
5. Version: page-level `updated_at` or generation counter for conflict with model turns. Per-block `version` remains for agent replace checks.

## API change required

Today the browser can only `PATCH /v1/blocks/{id}` (payload). That cannot express insert / delete / reorder from a notebook.

Add one route (shape, not bikeshed):

`PUT /v1/projects/{projectId}/pages/{pageId}/blocks`

Body: ordered list of `{ id, type, payload }`. Transaction: upsert by id, delete rows missing from the list, rewrite `position`, bump versions, refresh `chunks` for that page. Reject unknown types with 400.

Agent path unchanged: still applies ops server-side after a turn. Human path uses the page put. Both land in the same tables.

`contracts/openapi.yaml` must match. Ask before adding npm packages (`@blocknote/core`, `@blocknote/react`, `@blocknote/mantine` or the shadcn/style package BlockNote documents).

## What we still refuse

| Refusal | Why |
| --- | --- |
| Markdown file per page as SoT | Overturns [03](03-notes-sessions-flashcards.md); model ops lose stable ids. |
| BlockNote JSON column as SoT | Agent outline/search/chunks already keyed to our block rows. Dual SoT drifts. |
| Yjs / live collaboration | One human + one model turn. Ceiling comment if that changes. |
| BlockNote XL / paid export packs | Not needed for study notes. |
| Agent imports editor code | Boundary in AGENTS.md. |

## Build order (after dependency ask)

1. Page `PUT` blocks + chunk refresh + OpenAPI + one API test. **Done.**
2. Mapper: tidyai ↔ BlockNote for allowlisted types (round-trip text/rows/latex/ids). **Done** (`apps/web/src/lib/block-mapper.ts`).
3. Notes pane mounts BlockNote; remove textarea `BlockView` edit path. **Done.**
4. Debounced autosave + dirty/reload on `notes` event. **Done.**
5. Custom blocks: `equation`, `child_page`. Callout↔`quote`, toggle↔`toggleListItem`. **Done.**
6. Browser pass: editor mounts, PUT autosave returns 200, Saved label shows. Study-turn refetch still via `notes` + Reload if dirty.

## What would change this

- Mapper round-trips keep losing structure users care about (nested lists, marks). Then widen our payload schema (marks / children) instead of switching SoT to BlockNote JSON.
- BlockNote 0.x break costs more than TipTap + our own slash UI. Then rebuild UI on TipTap with the same mapper contract.
- Two humans edit one page. Then Yjs — still beside our SoT, not instead of it.
