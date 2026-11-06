# 05 — Architecture

Question: which processes exist, what they are forbidden to import, and which stacks lost.

This file cross-checks the earlier decisions. If a sentence here disagrees with files 01–04, 01–04 win and this file is wrong.

## Layers

```
apps/web            presentation. Panes, Streamdown (when chat lands), block views.
        |  HTTP + SSE. No provider keys in the JSON body.
services/api        application. Authn session, transactions, who may touch a project.
        |  calls functions. Does not contain prompts.
services/agent      AI. Routing, prompt assembly, provider streaming, note-op parse, card reconcile.
        |  returns data. Does not import FastAPI or SQL.
services/api/data   persistence. SQL, indexes, content hashes. Does not import an LLM client.
```

The dependency arrow points inward. `agent` does not know HTTP. `data` does not know prompts. `web` does not rank chunks. A turn transaction is owned by `api`: begin, call agent, write blocks and cards, commit, or roll back. The agent never holds a database connection. That split is what keeps a retry from double-applying a note op. The api applies the validated op list once.

Today the agent code is pure functions (route, card action, op validation) and tests. The api serves `/health` and nothing else. The web app is the pane shell from file 01. The contract for the rest is `contracts/openapi.yaml`. Endpoints in that file are intent, not a claim they respond.

## Processes

Three projects, one repo:

| Path | Runtime | Why it is its own project |
| --- | --- | --- |
| `apps/web` | Vite, React, TypeScript | UI iterates without restarting the model process. No SSR. |
| `services/api` | Python, FastAPI | Transactions, HTTP, SSE fan-out. |
| `services/agent` | Python, stdlib now | Prompt and policy code, testable without a server. |

A fourth service (a vector database, a queue, a reranker host) lost. One Postgres with `pgvector` covers rows, lexical search, and vectors. A queue is unnecessary while note ops run in the request that just finished streaming. If that tail ever exceeds a couple of seconds it can move to a job table. Not before we measure it.

Postgres runs from `docker-compose.yml` as `pgvector/pgvector`. Local password `tidyai` is for that compose file only.

## Stack arguments

### Web: Vite + React, not Next.js

The app is a three-pane client. The first byte of HTML does not need the note tree. SSR would put provider calls and key headers closer to a server framework we do not otherwise want. Vite is the smaller tool that still gives TypeScript and React. Streamdown is a React component either way.

Rejected: a desktop shell (Electron, Tauri) before the layout works in a browser. Rejected: a second UI framework. One component tree draws both chat fences and note blocks so equation rendering cannot drift.

### API: FastAPI, not Node

The agent wants Python (Pydantic, `fsrs`, the usual provider SDKs). Putting HTTP in the same language avoids a translation layer for note ops. Node would be justified if the API were only a proxy in front of Vercel AI SDK. We are not using that proxy, because the study-turn steps after the stream are ours.

Rejected: Django. Admin and ORM do not pay for themselves at this size. SQL can be explicit in the data layer when it exists.

### Agent framework: none

See file 04. The allowed graph is `route → maybe search → stream → structured ops → validate → return`. A loop that adds tools until the model stops is how cost escapes.

### Contract: OpenAPI, not a Postman collection yet

The interface is still intent. An OpenAPI file diffs in git and names the event stream. A runnable collection is worth adding when `/v1` routes exist and can be executed. Maintaining both now would mean mocking a server we have not built.

## Request path (when wired)

1. Browser decrypts the provider key and sends the turn.
2. `api` checks the session and the project owner. Missing key → 401 with a fixed error code, no echo.
3. `api` loads the outline and current page from `data`.
4. `agent.route_turn` picks `direct`, `retrieve`, or `agentic`.
5. On retrieve, `data` runs RRF inside the project. `agent` does not write SQL.
6. `api` streams provider tokens to the client as SSE `text` events. Keys stay in the provider call.
7. `agent` produces note ops and card intents. `agent.validate` rejects unknown block types.
8. `api` applies ops in one transaction, then card creates/updates. Card judge calls happen before the transaction, and the transaction writes the judge's result. A crash after the judge but before commit leaves no partial note. The judge may be called again on retry. That can spend a few tokens twice. It cannot tear the tree.
9. SSE `notes` event carries page ids that changed. Client refetches those pages.
10. SSE `cards` event carries created or updated card ids. Client does not expect full card bodies on the stream.

Event types are listed in the OpenAPI description. They are not a second undocumented protocol.

## Data sketch

Owned by Postgres, all rows scoped by `project_id` and `user_id`.

- `projects`, `chats`, `messages`
- `pages` (parent_id, title, depth)
- `blocks` (page_id, position, type, payload jsonb, version, content_hash)
- `chunks` (block_id, tsv, embedding, embedding_hash) — absent when there is no embedding key and the column stays null
- `cards` (topic_key, front, back, page_id, fsrs state, embedding)
- `reviews`

No key column. No prompt log that includes headers. Message bodies are stored because they are the user's notes-in-progress. That is content, not a secret, and it is still personal. Exports and deletion are per project: delete the project, delete pages, blocks, chunks, cards, chats.

## Cross-validation

| Decision | Checked against | Result |
| --- | --- | --- |
| Right-hand notes | Claude artifact split + "prose is a bad document" teardown | Kept. Mobile becomes an overlay, which the teardown already flags as necessary. |
| Do not write a markdown parser | Three existing streaming renderers describe the same unterminated-markdown failure | Kept. Engine is the turn pipeline. |
| Block ops, not full rewrite | Notion's public API | Kept. We copy the shape, not the catalog. |
| CRDT deferred | Notion added a text CRDT for multiplayer | We have one user and one model turn. Deferred stands. |
| Card cosine 0.92 plus a judge | Exact match misses paraphrases (anki-llm). 0.7 and even aggressive embedding dedupe drop real distinctions (ObsidianKi, lecture generator). | Kept as a threshold to measure. Judge cannot delete. |
| FSRS | Anki's current scheduler and a maintained Python package | Kept. SM-2 rejected. |
| Hybrid, no reranker | RRF is the standard fusion. Beconis shows rerank cost and mixed quality. SIDHYA's table was not reproducible here and disagrees in tone. | Reranker stays out. SIDHYA not used for sizing. |
| tsvector, not ParadeDB | AGPL + host availability vs. student-scale corpus | Kept, with an explicit upgrade. |
| Browser BYOK | TanStack header pattern, Engramia server-vault pattern, wallet pattern | Browser wins for v1. Server vault is the documented upgrade, not a compromise we half-build. |
| Cache-friendly prefix | Anthropic and OpenAI price sheets | Prefix order is a requirement, not a nice-to-have. |
| Skip indexing assistant text | Cost section's own duplication argument | Kept, with the exception when note update fails. |
| Vite + FastAPI + plain Python | Layer rules above | Kept. Next, Django, LangGraph rejected in writing so they do not creep back in as defaults. |

## Closed on 2026-11-06

- v1 is one person on this machine. No accounts. See [06-v1-plan.md](06-v1-plan.md).
- Note `replace` ops auto-apply. Accept/reject waits until a real edit gets overwritten.
- Providers are settings profiles, not a hardcoded vendor list. Same file.

## What is still open on purpose

- Billing dashboard. There is nothing to bill. The client can show provider error text.
- Collaboration, public sharing, dark mode, Anki export, web search.
- Flashcards. Rules stay in file 03. They are not in the next slice.

## Falsifiers, collected

Change the decision when the evidence shows up, not when a new library is fashionable.

- Notes pane unused on small screens → persistent handle.
- Streamdown frame drops on long math → try stream-md.
- Model overwrites user text → accept/reject on `replace`.
- Card merges or duplicates at 0.92 → move the constant using a labeled set.
- Memory questions routed `direct` → fix cues or replace the router.
- RRF misses that a reranker fixes, on our questions → add a reranker.
- Two devices → server envelope encryption.
- Formula search fails on `tsvector` → better tokenizer or an extension, license checked first.
