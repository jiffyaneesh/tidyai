# 04 — Retrieval, BYOK, cost

Question: how a study turn uses prior notes without pasting the whole project into the prompt, who pays for the model, and where the key lives.

## BYOK

The platform does not hold a shared inference key and does not bill tokens. Each user calls a provider with their own key.

### Where the key sits

| Option | Argument for | Argument against |
| --- | --- | --- |
| Browser only. Sent on the request. Server uses it and drops it. | Server database never contains a key. Matches TanStack AI's `defineByok`: key stays in the browser, goes out on a header, server reads it for one call. Source: [TanStack BYOK](https://tanstack.com/ai/latest/docs/advanced/byok). Confidence: **high** that this is their design. | Lost if local storage is cleared. No multi-device until the user exports. Server still sees the key in memory during the call. |
| Encrypted column on the server, master key in the operator env. | Multi-device. Engramia documents AES-256-GCM, random nonce, AAD bound to tenant+provider, write-only API, fingerprint on read. Source: [Engramia credentials](https://docs.engramia.dev/architecture/credentials/). Confidence: **high** as a description of their design. | We become custodians. Master-key loss locks every user out. A bug in logs leaks keys. More code before a single user exists. |
| Wallet extension that proxies the provider. Key never hits our origin. | Strongest version of "we never see it." Byoky describes this. Source: [Byoky docs](https://byoky.com/docs). Confidence: **medium**. | Install friction kills a notes app. A new user with a ChatGPT habit will not install a wallet to take notes. |

Decision for v1: **browser-held key, AES-256-GCM via Web Crypto, sent on `X-Provider-Key` for that request only, never logged, never in a query string, never written to Postgres.** The header is ugly on purpose: it is not a JSON field that ends up in an access log of request bodies. TanStack makes the same "header, not body" choice.

The server process must not print headers. Error text returned to the client says "Anthropic rejected the key" and not the key. HireOS's write-up is the operational version of this: borrow the key for one call, do not keep a warm client keyed globally across users, do not fall through to some other provider the user did not pick. Source: [HireOS BYOK](https://jawadhassan.dev/blog/byok-llm-architecture). Confidence: **medium** (one team's post).

Local storage threat: any XSS reads the key. Hardening in the render engine (no model HTML) is part of this decision, not a separate nicety. Content-Security-Policy comes with the web app when it is served for real. v1 shell is a local dev server.

Multi-device and "I cleared my cache" are accepted holes. Export of an encrypted blob can wait. Server-side envelope encryption is the upgrade if we see real multi-device demand. We do not build it speculatively. `ponytail:` ceiling is one browser profile; upgrade path is Engramia-style envelope encryption, not a wallet requirement.

Embeddings are a second slot. A chat key for Anthropic does not embed on OpenAI. If the embedding slot is empty, retrieval is lexical only and card dedupe is exact-key only. The product still runs.

## What gets retrieved

A study turn usually continues the current page. Pasting the project is the expensive default and the one CA-RAG argues against: simple questions waste context, hard questions starve on a fixed top-k. On their 28-query set, a router that picks a depth used about 26% fewer billed tokens than always-deep, with a quality proxy they call equivalent. Confidence: **low-medium**. N is 28 and the quality metric is a proxy. The direction matches the product, the percentage is not a promise. Source: [CA-RAG, arXiv:2606.02581](https://arxiv.org/html/2606.02581).

VikingRAG's claim is stronger and narrower: on their structured-document sets, directory-aware retrieval plus "only do another hop when evidence is thin," and reuse of old retrieval traces, cut tokens to a fraction of agentic baselines (they report 11.6–51.9% of baseline tokens, and 5.1–32.5% with trace reuse). Confidence: **medium** that the paper reports this, **low** as a forecast for tidyai. Source: [VikingRAG, arXiv:2609.11390](https://arxiv.org/html/2609.11390v1).

We take the mechanism, not the percentage:

1. Always include the project outline (titles + one line). It is small and stable, so it can sit in a cached prompt prefix.
2. Default route is **direct**: outline + current page blocks + the new question. No vector query.
3. **retrieve**: one hybrid search, top 8 chunks, when the question clearly points at older notes.
4. **agentic**: a second search only if the first pack is insufficient. Cap at 2 searches. No open-ended tool loop.

The v1 router is lexical and biased toward **direct**. A false "agentic" label spends money. A false "direct" label makes a weaker answer the user can rephrase. Cues live in `services/agent`. They are a ceiling, not an NLP system. Upgrade is a tiny classifier when the cue list is wrong often enough to notice. We will notice from a route label stored on the turn, not from vibes.

### Hybrid search

BM25 (or any lexical ranker) and vectors fail differently. Lexical hits exact terms, formulas, and names. Vectors hit paraphrases. Fusing ranks with Reciprocal Rank Fusion avoids averaging incompatible scores. RRF with k = 60 is the usual default from the Cormack, Clarke, Buettcher paper (SIGIR 2009). We did not re-read the paper in this session; the constant is used the same way in ParadeDB's hybrid write-up and in independent Postgres write-ups. Confidence in the formula: **high**. Confidence that k = 60 is optimal for study notes: **low**. We start at 60.

Measured objections, which we accept:

- Beconis, on three public benchmarks, found a strong embedding model hard to beat, and found RRF can promote a weak lexical list into the top. Reranking 100 candidates cost hundreds of milliseconds on a 4070. Confidence: **medium** (one author, stated method, not our corpus). Source: [Hybrid search and reranking, measured](https://sbeconis.com/writing/hybrid-search-and-reranking-measured/).
- A 2026 SIDHYA post publishes an NDCG table where hybrid+rerank wins. Confidence: **low**. Single post, we did not reproduce it, and it disagrees in emphasis with Beconis. We do not size hardware from that table. Source: [SIDHYA hybrid blueprint](https://sidhya.studio/posts/hybrid-search-rrf-rerank-practical-2026).

Decision:

- **v1 fusion is RRF, k = 60, 40 lexical + 40 vector candidates, return 8.** No cross-encoder reranker. Beconis is enough reason to refuse a reranker until our own questions show a top-8 miss that a reranker would have fixed. A reranker is also another model bill on the user's key, or a GPU we do not have.
- **Lexical engine is Postgres `tsvector` / `ts_rank_cd`, not ParadeDB.** ParadeDB `pg_search` is real BM25 inside Postgres (Tantivy) and is the better ranker. It is AGPL, and a 2026 measurement notes Neon dropped it for new projects. `pg_textsearch` is another extension with its own availability story. Sources: [ParadeDB hybrid manual](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual), [pg_search intro](https://www.paradedb.com/blog/introducing-search), [zeybek, hybrid in Postgres](https://zeybek.dev/blog/hybrid-search-in-postgres-measured). Confidence: **medium** on the license and the Neon note (the Neon note is that author's report).
- Native full text is weaker and it runs on every Postgres that already has `pgvector`. For a corpus the size of one student's notes, BM25-vs-tsvector is not the bottleneck. The upgrade is `pg_search` or `pg_textsearch` after a labeled eval, and only if the extension's license and host are acceptable.
- Vectors: `pgvector` HNSW, cosine. Embeddings stored with a content hash. Unchanged blocks are not re-embedded.
- Chunks are blocks, not sliding character windows. A block is already the unit we edit. Chunking a paragraph in half fights the note model. A long table is one chunk. If a block exceeds ~1500 tokens it is split, with the heading repeated. That split is the exception.

Filter every query by `project_id`. A hybrid index without that filter leaks one subject into another. That is a correctness bug, not a tuning issue.

### Prompt shape and cache

Cache reads are only cheap if the prefix is byte-stable. Anthropic's pricing doc: a 5-minute cache write is 1.25x input, a 1-hour write is 2x, and a cache read is 0.1x input on most models (0.05x on Opus 5.5 and Sonnet 5.5, 0.025x on Fable 5.1 and Mythos 5.1). Their marketing line of "up to 90%" matches the 0.1x read, not the newer deeper discounts. OpenAI documents cached input discounted up to 95%. These are vendor price sheets, **high** confidence as prices, **not** a measurement of our hit rate. Sources: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

So the prefix order is fixed:

1. System instructions and the JSON schema (stable).
2. Project outline (changes only when titles change).
3. Retrieved chunks and the new user turn (volatile, last).

Putting the user question first throws away the cache. Model switches throw it away too. That is fine: the picker is per conversation, not per token.

Note-op and card-judge calls use the cheapest model the user enabled, not the chat model, when those ids differ. A strong model for the visible answer and a small model for the JSON patch is the cost split. If the user only configured one model, both calls use it. We never send the patch to a model the user did not select.

Side calls are not streamed. They are short. Streaming them would not move the UI; the chat is already on screen.

## What we rejected

| Option | Why it lost |
| --- | --- |
| LangGraph (or any agent framework) as the runtime | The graph is four steps with a cap. A framework would be the most abstract code in the repo and the hardest to see costs in. |
| Always-on tools (web search, code, multi-hop) | This is a notes app. Web search is a later toggle. Default tools are "search this project" and even that is conditional. |
| Reranker in v1 | Latency and a second bill, evidence of benefit is contested. |
| ParadeDB in v1 | AGPL and host risk, for a ranker we have not shown we need. |
| Server-side key vault in v1 | Custody without a multi-device user. |
| Platform-paid embeddings | Breaks BYOK. Quietly becomes our bill. |
| Index every assistant token | Duplicates the note, costs embeddings, pollutes search. |

## What would change this

- Route labels show memory questions landing on `direct` and the answer ignoring older notes. Then add retrieval, or replace the cue list.
- A 30-question set from real projects where RRF top-8 misses a lexical needle that a reranker hits. Then add a reranker behind a per-project flag.
- Users on two devices. Then envelope-encrypted server keys, with the Engramia invariants (AAD, write-only, no plaintext logs).
- `ts_rank_cd` failing on formula-heavy notes (symbols split into junk tokens). Then a tokenizer that keeps `$...$` and identifiers intact, likely via an extension.
