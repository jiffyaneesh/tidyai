# 11 — Study modes (Notes | Web)

Date: 2026-11-07. Updated 2026-11-26.

## Decision

One shell, two modes (header toggle). Not a second page.

| Mode | Retrieve | Note writes | User pick |
| --- | --- | --- | --- |
| **notes** | `search_notes` only | **None** (pure Q&A) | B1 |
| **web** | Web search (see below), any chat host | After answer, same note-op path | A1 → A2 |

Defaults: new chats start in **web** (build the notebook). Switch to **notes** to quiz the tree without mutating it.

## A2 — web search without a model lock-in (2026-11-26)

A1 said only provider-native search (OpenAI `web_search_options` / Gemini grounding). Groq and other Chat Completions hosts reject that body and the turn failed before note writes. Evidence: user report, 2026-11-26.

| Host | How web mode searches |
| --- | --- |
| `gemini` | Provider Google Search grounding (unchanged) |
| `openai_chat` on `api.openai.com` (and `*.openai.com`) | `web_search_options` on the chat request |
| Any other `openai_chat` host (Groq, OpenRouter, local, …) | Server runs `search_web` (Wikipedia search + page summaries, no user key), attaches snippets as a tool result, then streams the answer **without** `web_search_options` |

Note ops still run after the answer on every web turn. Soft search failure → empty snippets; the model may still answer; the turn does not hard-fail on “wrong provider.”

No Tavily/Brave key. Same two wire protocols. `search_web` lives in the agent package and uses the same egress rules as provider calls (fixed origin `en.wikipedia.org`, no user-chosen URL). DuckDuckGo HTML was tried first and serves a bot captcha to server clients, so it is not usable keyless.

## B1 — notes mode writes

Skip `note_ops_from_answer` entirely. Chat answer only. Notes pane unchanged unless user edits BlockNote by hand.

## Rejected

| Option | Why |
| --- | --- |
| Separate Notes page | Same subject/chat tree; mode is enough |
| Always web search | Breaks offline/local BYOK and study-from-notes |
| Separate search API key (Tavily/Brave) | Keyless Wikipedia covers study facts for Groq; swap behind the same tool for open-web |
| Suggest-update button in notes mode | User chose pure Q&A |
| Hard-fail web mode when the host lacks native search | Overturned: blocks note writing for most BYOK hosts |

## What would change this

- Wikipedia is not enough (news, product pages, papers) → keyed Brave/Tavily behind the same `search_web` shape (ask before adding the dependency).
- Search-capable Chat Completions hosts disappear → branch Responses `web_search` in `stream_chat` for the OpenAI host only.
- Users need “answer from notes, then offer Apply” → reopen B.
