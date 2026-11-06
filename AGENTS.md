# tidyai

Study workspace for one person on this machine. A project is a subject, a chat is a study session, and the right pane is a block tree the session updates. The user brings the provider key. The platform does not store it and does not resell tokens.

Locked decisions live in `docs/research/`. Read the file for the area you are about to change. Do not reopen a decision there unless the user brought new evidence. `docs/research/06-v1-plan.md` is the current slice: saved streaming chat plus note updates. Flashcards, hybrid retrieval, and accounts are specified and not built.

## Run

From the repo root, database first:

```bash
docker compose up -d
```

Postgres is `127.0.0.1:5434`, database `tidyai`, user `tidyai`, password `tidyai`. That password is local only. Ports 5432 and 5433 were already taken on the machine this was set up on.

```bash
cd services/api
python3 -m venv .venv
.venv/bin/pip install -e ../agent -e .
.venv/bin/uvicorn tidyai_api.main:app --reload --port 8000
```

```bash
cd apps/web
npm install
npm run dev
```

Web: `http://127.0.0.1:5173`. API health: `http://127.0.0.1:8000/health` with `"db":"ok"`.

## Schema

There is no Alembic history. `services/api/src/tidyai_api/schema.sql` is the only migration. It is idempotent (`IF NOT EXISTS`). The API applies it on startup. Apply it without booting the server:

```bash
cd services/api
.venv/bin/python -c "import asyncio; from tidyai_api.db import init_schema; asyncio.run(init_schema())"
```

A new table or column is a new statement in that file, still idempotent, applied the same way. Do not add a second migration tool until this file cannot express the change.

## Boundaries

| Module | Owns | Must not |
| --- | --- | --- |
| `services/agent` | Prompts, streaming, note-op checks | FastAPI, psycopg, SQL, reading env secrets |
| `services/api` | HTTP, transactions, SQL | Prompt text, provider URL assembly |
| `apps/web` | Panes, vault, Streamdown, block views | Ranking, SQL, putting the key in JSON |

These are the SOLID rules that matter here:

- One module, one reason to change. A provider bug is fixed in `stream.py`. A transaction bug is fixed in `db.py`. A layout bug is fixed in `apps/web`.
- A new OpenAI-compatible host is a settings row (base URL and model). A new wire protocol is a branch in `stream_chat`, not a rewrite of the turn route.
- `ProviderError` is the only failure the API should show the user from a provider call. Do not leak `httpx` exceptions or request headers across that boundary.
- The turn body has no API key. `X-Provider-Key` is the only secret input. Do not add the key to a query string, log line, or SSE event.
- The API calls agent functions. The agent does not import the API or the database.

KISS ceilings already chosen. Do not cross them in a drive-by:

- No LangGraph or other agent framework. The turn may call `search_notes` at most twice, then stream, then one note-op call, then validate.
- No third provider protocol (Anthropic native, Cohere, a plugin loader) until a host cannot be expressed as `openai_chat` or `gemini`.
- No card tables, reranker, separate vector database, or accounts. Retrieval is Postgres `tsvector` plus `pgvector` in `schema.sql`. Chunks are blocks. Embeddings are optional. A missing embedding model means keyword search.
- `ponytail:` comments name a ceiling and the upgrade. Do not delete them to look tidy, and do not build the upgrade early.

## UI

The shell is three panes: sidebar 260px (rail 56px), chat column capped at 768px, notes 360px. Under 960px the notes pane is an overlay. Its Close control must stay reachable. Do not cover it with the pane.

- Use the tokens in `apps/web/src/styles.css`. One accent, `--accent`. Do not add a second brand color.
- Body text on `--bg` and `--surface` stays at least 4.5:1. Do not lighten `--muted`.
- Panel open is 250ms, close is 200ms. `prefers-reduced-motion: reduce` disables those transitions. Do not animate each streamed token.
- Chat markdown goes through Streamdown. Notes go through `BlockView`. Do not render model HTML. Do not add `dangerouslySetInnerHTML` for model output. KaTeX stays `trust: false`.
- Icon-only buttons need an `aria-label`. Inputs need a label. Enter sends. Shift+Enter inserts a newline.
- After a turn, refetch the pages the `notes` event names. Do not merge token text into the block tree.
- Clicking the already selected subject must not clear the open page.

## Security

- Never log `X-Provider-Key`, `Authorization`, or `x-goog-api-key`. Redact `sk-…` and `AIza…` before any error string leaves the process.
- Provider calls use `follow_redirects=False`. A redirect is an error. The key is not forwarded.
- Base URLs must be `http` or `https`, with no username or password. Localhost is allowed because local models are a feature. Do not add accounts on top of a client-supplied base URL. That becomes server-side request forgery.
- The browser vault key is non-extractable, in IndexedDB. Ciphertext lives in `localStorage`. Do not fall back to storing the provider key in plaintext.

## Verify

| Change | Command |
| --- | --- |
| Agent policy or streaming | `cd services/agent && PYTHONPATH=src python3 -m unittest discover -s tests -v` |
| One agent test file | `cd services/agent && PYTHONPATH=src python3 -m unittest tests.test_stream -v` |
| API turn, Postgres up | `cd services/api && .venv/bin/python -m unittest tests.test_turn_flow -v` |
| Web types | `cd apps/web && npx tsc --noEmit` |
| Web behavior | Load `http://127.0.0.1:5173`, send a turn, confirm the note pane updates and the key is not visible |

Run the narrowest check that covers the edit. Say what you could not run.

## Always / ask / never

Always:

- Parameterized SQL. No string-built queries.
- Idempotent schema changes in `schema.sql`.
- Keep `contracts/openapi.yaml` matched to routes you add or remove.

Ask before:

- A new dependency, a new service, or a new wire protocol.
- A migration that drops or rewrites existing rows.
- Committing, unless the user asked.

Never:

- Commit `.env`, provider keys, or `services/api/.venv`.
- Edit `node_modules` or egg-info.
- Put the provider key in the turn JSON.
- Auto-delete notes or, later, flashcards.
- Add a `Co-authored-by` trailer. Not for Cursor, not for any other agent. The commit author is the person who asked for the commit.

## Where the long version is

`docs/research/` holds the arguments. This file holds only the rules an agent must follow. `docs/research/07-agent-instruction-files.md` records why this file is shaped this way.
