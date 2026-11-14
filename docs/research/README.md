# tidyai research

Date: 2026-11-06. Goal: decide the product, the interface, the render path, the study loop, retrieval, BYOK, and the process split before any feature code piles up.

These notes are the argument, not a pitch. Each file records options, evidence, the decision, and what would overturn it. Vendor marketing numbers and single-author benchmarks are labeled. They are not treated as laws.

For the **as-built** system map (processes, tech stack, function-level flows, ceilings), see [architecture.md](../architecture.md).

## How to read

| File | Decision it locks |
| --- | --- |
| [01-chat-interface.md](01-chat-interface.md) | Three panes, motion, color, what is on screen |
| [02-render-engine.md](02-render-engine.md) | What "dedicated engine" means, and what we will not parse ourselves |
| [03-notes-sessions-flashcards.md](03-notes-sessions-flashcards.md) | Projects, sessions, block notes, card create / update / skip |
| [04-retrieval-byok-cost.md](04-retrieval-byok-cost.md) | Hybrid retrieval, when the agent loop runs, who pays, where keys live |
| [05-architecture.md](05-architecture.md) | Processes, module boundaries, rejected stacks, contract |
| [06-v1-plan.md](06-v1-plan.md) | First slice after the skeleton: local user, settings-driven providers, chat plus notes |
| [07-agent-instruction-files.md](07-agent-instruction-files.md) | What belongs in AGENTS.md and CLAUDE.md, and why the rules are checks |
| [08-rag-tools.md](08-rag-tools.md) | Chunks, pgvector, and a capped search tool. Not a second database |
| [09-notes-pane-ui.md](09-notes-pane-ui.md) | Notes pane resize; TipTap rejection later overturned |
| [10-notes-editor-engine.md](10-notes-editor-engine.md) | BlockNote notes engine; Postgres blocks stay SoT; autosave |
| [11-study-modes.md](11-study-modes.md) | Notes vs Web; A1 provider web search; B1 notes = pure Q&A |
| [12-fault-ux.md](12-fault-ux.md) | Prevent invalid actions; sticky vs toast; Sonner |
| [13-workspace-polish.md](13-workspace-polish.md) | Layout persist/resize; chat pin + accessible reorder; rename |

## Confidence legend

- **High.** Official docs, a spec, or a measurement we can recompute (contrast ratios in this repo).
- **Medium.** A reputable write-up with a stated method, or a product we can see, but not our own measurement.
- **Low.** One blog, a marketing line, or a number we did not reproduce. Cited only as a claim.

## Product in one paragraph

tidyai is a study workspace. A project is a subject. Inside it, chats are study sessions. The center pane is the session. The right pane is a nested note tree that the session updates. Each topic touched by a session gets a flashcard, unless a card for that topic already exists and does not need a change. The user brings provider keys. The platform does not resell tokens.

## What is deliberately not built yet

Flashcards, a reranker, accounts, and a separate vector database. Search is `search_notes` against Postgres, at most two calls. See [08-rag-tools.md](08-rag-tools.md).
