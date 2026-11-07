# 11 — Study modes (Notes | Web)

Date: 2026-11-07.

## Decision

One shell, two modes (header toggle). Not a second page.

| Mode | Retrieve | Note writes | User pick |
| --- | --- | --- | --- |
| **notes** | `search_notes` only | **None** (pure Q&A) | B1 |
| **web** | Provider-native web search (A1) | After answer, same note-op path | A1 |

Defaults: new chats start in **web** (build the notebook). Switch to **notes** to quiz the tree without mutating it.

## A1 — provider web search

No Tavily/Brave key. Stay on `openai_chat` / `gemini` wire protocols.

- **openai_chat:** request body may include `web_search_options` (Chat Completions search path). Hosts that reject it surface a clear SSE error: pick OpenAI search-capable model or Gemini.
- **gemini:** attach Google Search grounding tool on the generate request.

No Responses API / third protocol until Chat Completions + Gemini grounding cannot cover real study hosts.

## B1 — notes mode writes

Skip `note_ops_from_answer` entirely. Chat answer only. Notes pane unchanged unless user edits BlockNote by hand.

## Rejected

| Option | Why |
| --- | --- |
| Separate Notes page | Same subject/chat tree; mode is enough |
| Always web search | Breaks offline/local BYOK and study-from-notes |
| Separate search API key | User chose A1 |
| Suggest-update button in notes mode | User chose pure Q&A |

## What would change this

- Search-capable Chat Completions hosts disappear → branch Responses `web_search` in `stream_chat` (still not a third “brand” protocol; same openai family).
- Users need “answer from notes, then offer Apply” → reopen B.
