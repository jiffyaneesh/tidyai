# tidyai

Claude Code loads this file every session. The rules live in [AGENTS.md](AGENTS.md). If the two disagree, change `AGENTS.md` and keep the import. Do not copy rules into both files.

@AGENTS.md

## This session

- Apply `services/api/src/tidyai_api/schema.sql` with `init_schema`. Do not add Alembic while that file can express the change.
- A UI edit is not done until it has been used in the browser, or you say which step you could not run.
- Do not start LangGraph, a card deck, a separate vector database, a reranker, or a third provider protocol unless the user asked for that slice. `search_notes` and the `chunks` table are the retrieval slice.
