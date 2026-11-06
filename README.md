# tidyai

Study workspace. A project is a subject. Chats are study sessions. Notes on the right are built from those sessions. Flashcards are created or updated per topic, not duplicated. You bring the model key.

Research, arguments, and the decisions that follow live in [docs/research](docs/research/README.md). Read that before adding a library or a second service.

## Layout

| Path | Role |
| --- | --- |
| `apps/web` | React shell. Sidebar, chat column, notes pane. |
| `services/api` | HTTP process. Projects, sessions, streaming turns, note writes. |
| `services/agent` | Turn policy and the provider stream. No database. |
| `contracts/openapi.yaml` | Live API. Flashcards are not in this version. |
| `docker-compose.yml` | Local Postgres with pgvector. |

`services/agent` must not import FastAPI or a database driver. `services/api` owns transactions. The web app never sees a provider key inside a JSON body.

## Run

Web:

```bash
cd apps/web
npm install
npm run dev
```

Database, then API. The compose file publishes Postgres on localhost port 5434 because 5432 is often already taken. The password is for this local database only.

```bash
docker compose up -d
cd services/api
python -m venv .venv
.venv/bin/pip install -e ../agent -e .
.venv/bin/uvicorn tidyai_api.main:app --reload --port 8000
```

Add a provider in Settings. OpenAI-compatible base URLs cover OpenAI, Groq, Together, Ollama, and other local servers. Gemini uses the Gemini protocol. The key stays in the browser.

Notes are searched with Postgres full text. An optional embedding model on the same profile adds vectors. Leave it empty and search stays lexical. The chat model can call `search_notes` at most twice per turn. There is no separate vector database.

Agent checks:

```bash
cd services/agent
PYTHONPATH=src python3 -m unittest discover -s tests -v
```
