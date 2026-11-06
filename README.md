# tidyai

Study workspace. A project is a subject. Chats are study sessions. Notes on the right are built from those sessions. Flashcards are created or updated per topic, not duplicated. You bring the model key.

Research, arguments, and the decisions that follow live in [docs/research](docs/research/README.md). Read that before adding a library or a second service.

## Layout

| Path | Role |
| --- | --- |
| `apps/web` | React shell. Sidebar, chat column, notes pane. |
| `services/api` | HTTP process. Health only, until the contract is implemented. |
| `services/agent` | Turn policy: route, card action, note-op checks. No network. |
| `contracts/openapi.yaml` | Intended API. Not all routes are implemented. |
| `docker-compose.yml` | Local Postgres with pgvector. |

`services/agent` must not import FastAPI or a database driver. `services/api` owns transactions. The web app never sees a provider key inside a JSON body.

## Run

Web:

```bash
cd apps/web
npm install
npm run dev
```

API:

```bash
cd services/api
python -m venv .venv
.venv/bin/pip install -e .
.venv/bin/uvicorn tidyai_api.main:app --reload --port 8000
```

Agent checks:

```bash
cd services/agent
PYTHONPATH=src python -m unittest discover -s tests -v
```

Database (optional until persistence exists):

```bash
docker compose up -d
```

The compose password is for local Postgres only.
