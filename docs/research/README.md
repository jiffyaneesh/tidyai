# tidyai research

Date: 2026-11-06. Goal: decide the product, the interface, the render path, the study loop, retrieval, BYOK, and the process split before any feature code piles up.

These notes are the argument, not a pitch. Each file records options, evidence, the decision, and what would overturn it. Vendor marketing numbers and single-author benchmarks are labeled. They are not treated as laws.

## How to read

| File | Decision it locks |
| --- | --- |
| [01-chat-interface.md](01-chat-interface.md) | Three panes, motion, color, what is on screen |
| [02-render-engine.md](02-render-engine.md) | What "dedicated engine" means, and what we will not parse ourselves |
| [03-notes-sessions-flashcards.md](03-notes-sessions-flashcards.md) | Projects, sessions, block notes, card create / update / skip |
| [04-retrieval-byok-cost.md](04-retrieval-byok-cost.md) | Hybrid retrieval, when the agent loop runs, who pays, where keys live |
| [05-architecture.md](05-architecture.md) | Processes, module boundaries, rejected stacks, contract |
| [06-v1-plan.md](06-v1-plan.md) | First slice after the skeleton: local user, settings-driven providers, chat plus notes |

## Confidence legend

- **High.** Official docs, a spec, or a measurement we can recompute (contrast ratios in this repo).
- **Medium.** A reputable write-up with a stated method, or a product we can see, but not our own measurement.
- **Low.** One blog, a marketing line, or a number we did not reproduce. Cited only as a claim.

## Product in one paragraph

tidyai is a study workspace. A project is a subject. Inside it, chats are study sessions. The center pane is the session. The right pane is a nested note tree that the session updates. Each topic touched by a session gets a flashcard, unless a card for that topic already exists and does not need a change. The user brings provider keys. The platform does not resell tokens.

## What is deliberately not built yet

Chat streaming, the database, and auth are specified in [05-architecture.md](05-architecture.md) and `contracts/openapi.yaml`. The code in `apps/web`, `services/api`, and `services/agent` is the skeleton those decisions require: the pane shell, the HTTP process, and the pure turn rules (route, card action, note-op check) with tests. Wiring a model call before those rules were written would hide the cost decisions inside a prompt.
