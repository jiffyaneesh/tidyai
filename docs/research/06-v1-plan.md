# 06 — v1 plan

Locked 2026-11-06 from the build questions.

| Choice | Decision |
| --- | --- |
| Who | One person, this machine. No accounts, no session cookie. |
| Notes | Auto-apply block ops. Edit the note afterward. |
| Slice | Streaming chat that is saved, plus real note updates. Flashcards stay specified and unbuilt. |
| Providers | A settings profile, not a code change per vendor. |

## Provider adapter

Two wire protocols. Every host the user adds is a profile: label, protocol, base URL, model id. The key stays in the browser vault and rides the request header. Nothing in Postgres names a vendor.

| Protocol | Speaks | Covers without new code |
| --- | --- | --- |
| `openai_chat` | `POST {base}/chat/completions`, SSE chunks | OpenAI, Groq, Together, OpenRouter, Ollama, llama.cpp, vLLM, Gemini's OpenAI-compatible endpoint |
| `gemini` | Gemini `generateContent` stream | Native Gemini when the compatible endpoint is the wrong shape |

Adding Groq or a local server is a new settings row: base URL plus model id. A third wire protocol is a code change. That is the ceiling. `ponytail:` do not add Anthropic, Cohere, or a plugin loader until a profile cannot express the host.

Robust means the failures are visible and the key is not:

- Missing key, unknown protocol, non-2xx upstream, or a mid-stream drop becomes an SSE `error` with a fixed code. The body must not echo the key or the raw Authorization header.
- Timeout on the upstream socket. A hung local server must not pin the request forever.
- Note ops run only after the assistant text has been stored. A bad op list leaves the chat and leaves the previous blocks.
- One repair call if the op JSON does not parse. Then stop.

**Warning:** the base URL is whatever the settings row says, including localhost. That is required for a local model. The server will fetch that URL with the user's key. Fine for a single-user app on one machine. The moment this is multi-tenant, a client-supplied base URL is server-side request forgery and must be allowlisted. Do not "just" add accounts on top of this fetcher.

## Build order

1. Postgres tables for projects, chats, messages, pages, blocks. No card tables in this slice.
2. Settings screen: profiles in the browser. Encrypted key, editable base URL and model. No restart, no env edit.
3. `services/agent` streaming client for `openai_chat` and `gemini`. API passes the profile through. Agent still does not open SQL.
4. `POST /v1/chats/{id}/turns` streams `text`, then the API commits the message, asks for note ops, validates, auto-applies, emits `notes`.
5. Web shell reads real projects and pages. The center pane renders the live stream. The right pane refetches on `notes`.

Cards, review, FSRS, and hybrid retrieval indexes wait until a turn can already update a note. Retrieval in this slice is the current page plus the outline, which is the `direct` route. Do not build the vector index in the same change.
