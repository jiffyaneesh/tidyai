# 08 — Retrieval that is actually on

Question: the chat cannot hold a whole subject, so how do we fetch the right notes quickly without a second database or an open tool loop.

Checked against the code on 2026-11-06 before this slice: `schema.sql` had projects, chats, messages, pages, and blocks. No `chunks` table. The `pgvector/pgvector:pg17` image was running, and `CREATE EXTENSION vector` had never been applied. `POST /v1/chats/{id}/turns` called `study_messages`, which pastes the outline and the current page, each cut at 12,000 characters. `route_turn` in `services/agent` was not called by that route. No embedding request, no tool schema.

## Separate vector database

| Option | Argument for | Argument against |
| --- | --- | --- |
| Qdrant, Chroma, or a hosted vector service | Purpose-built ANN, sometimes simpler query APIs. | A fourth process. The notes already live in Postgres. Two stores drift. File 05 already rejected this. |
| Postgres `tsvector` + `pgvector` | One transaction with the note write. Filter by `project_id` in the same query. The image is already `pgvector/pgvector`. | Weaker lexical rank than Tantivy BM25. ANN quality depends on the user's embedding model. |
| Vectors only, no lexical | One index. Paraphrase search. | Misses symbols, formula names, and exact terms the student just typed. |

Decision: **no separate vector database.** Chunks live in the same Postgres. Lexical search always works. Vectors are added when the settings profile has an embedding model.

ParadeDB and a cross-encoder reranker stay rejected for the reasons in file 04. Beconis measured reranking 100 candidates at hundreds of milliseconds on a 4070, and RRF can promote a weak list. Confidence: **medium**, not our corpus. We will not add a reranker until a real question misses the top 8 and a reranker would have fixed it. Source: [Hybrid search and reranking, measured](https://sbeconis.com/writing/hybrid-search-and-reranking-measured/).

Fusion stays Reciprocal Rank Fusion, k = 60, 40 lexical candidates and 40 vector candidates, return 8. The formula is the Cormack, Clarke, Buettcher default as used in file 04. Confidence that k = 60 is optimal for study notes: **low**.

## What gets chunked

A block is already the edit unit. Sliding windows cut a paragraph in half and then the note editor and the index disagree. A block under 4,000 characters is one chunk. A longer block is split, and the page title is repeated on each piece. Cap 8 pieces. `ponytail:` the cap is characters, not tokens. A tokenizer is the upgrade if formula-heavy blocks split badly.

Indexed:

- Note blocks, prefixed with the page title.
- User messages, so "what did I ask about" can hit.
- Assistant text only when the note update failed. A successful note is the copy we want to find. Indexing both duplicates the note and pollutes search. File 03 already made that call.

Every query filters `project_id`.

## Tool calling, not a stuffed prompt

Stuffing the top 8 into every turn is the expensive default. CA-RAG's router used fewer tokens than always-deep on their 28-query set. Confidence: **low-medium** (small N, proxy metric). Source: [CA-RAG, arXiv:2606.02581](https://arxiv.org/html/2606.02581). VikingRAG's narrower claim is the same shape: another hop only when the evidence is thin. Confidence: **low** as a forecast for this app. Source: [VikingRAG, arXiv:2609.11390](https://arxiv.org/html/2609.11390v1).

The keyword router in `route_turn` guesses before the model speaks. It is the wrong trigger once the model can call a tool. The model sees the outline and the current page, which are small, and calls `search_notes` only when that page is not enough. That keeps the fast path to one stream.

The loop is capped:

1. Stream with the tool available.
2. If the model calls `search_notes`, run one hybrid query and stream again.
3. A second search is allowed. The third model call has no tools, so it must answer.

No web search, no code tool, no open loop. Claude and ChatGPT look broad because they have many tools and a paid retrieval stack. Copying that loop here would bill the user's key until the model got bored. The mechanism we can actually match is: hybrid index, project filter, model-decided search, hard hop cap. The answer quality is still the model the user picked.

## Embeddings stay optional

The chat key often cannot embed. Groq chat keys are the obvious case. The profile has an optional embedding model, base URL, and key. The key rides `X-Embedding-Key`, not the turn JSON. Empty model means lexical search only, and the turn still answers.

Stored vectors are 1536 floats (`vector(1536)`), which `text-embedding-3-small` can emit and which Gemini's embed call accepts as `outputDimensionality`. A vector of any other width is dropped. Unchanged text is not re-embedded: the row keeps a content hash. At most 32 missing vectors are filled per turn, so a backfill cannot block the first token forever. `ponytail:` one width. A second column is the upgrade if a model we care about cannot emit 1536.

## What would overturn this

- A labeled set of study questions where the right note is outside the top 8 often enough to notice. Then a reranker is in play.
- Embedding models we actually use cannot emit 1536. Then the column width changes.
- Syncing every block on each turn shows up in the turn time. Then a dirty set replaces the full scan.
- The user asks for web search. That is a new tool with its own cap, not a change to this one.
