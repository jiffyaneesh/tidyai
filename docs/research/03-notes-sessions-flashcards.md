# 03 — Projects, sessions, notes, flashcards

Question: how a subject, a study session, a nested note, and a flashcard relate, and how an answer updates notes and cards without duplicating or thrashing them.

## Concepts

| Term | Meaning |
| --- | --- |
| Project | A subject. Owns the note tree, the chats, and the card deck. |
| Chat | One study session inside a project. A log of turns. Not the source of truth for what was learned. |
| Note page | A node in the project's tree. Has a title and an ordered list of blocks. |
| Block | One paragraph, heading, list item, equation, table, callout, toggle, to-do, divider, or child-page reference. Stable id. |
| Card | One prompt/answer pair for a topic, plus FSRS scheduling state. Belongs to the project. Linked to the note page it came from. |

A session gradually builds the tree. The chat remains so the user can see why a block appeared. Retrieval indexes note blocks and user messages, not the full assistant transcript. The transcript mostly repeats the note after a successful update. Indexing both doubles embedding cost and retrieval noise. Assistant text is still stored, for the thread. It is not embedded unless the note update failed and that answer is the only copy of the explanation. That exception is explicit so a failed note write does not delete knowledge.

## Why blocks, not a markdown file

Notion's API models a page as a list of typed block objects. Some types have children. A child page inside a page is a reference, not an inline copy of that page. You update a block by its id. You add children by appending. You do not GET the whole page, rewrite it, and PUT it back. Sources: [Working with page content](https://developers.notion.com/guides/data-apis/working-with-page-content), [Block](https://developers.notion.com/reference/block), [Update a block](https://developers.notion.com/reference/update-a-block), [Append block children](https://developers.notion.com/reference/patch-block-children). Confidence: **high** (official API).

That is the right shape for "every answer updates the notes":

- The model names block ids it was shown in an outline.
- Operations are `insert`, `replace`, `delete`. Small.
- A bad operation fails validation and the previous tree stays.
- Rewriting the whole note on every turn is more tokens, more merge conflicts with a user who edited a paragraph, and more chances to drop a section the model was not thinking about.

We do not copy Notion's entire block catalog (databases, synced blocks, breadcrumbs). The allowlist is the study set in [02-render-engine.md](02-render-engine.md).

Nesting: a `child_page` block points at another page. The model may create a page when a new topic title has no match. Depth is capped at 3 for automatic creates. Deeper trees from an enthusiastic model become unreadable, and the cap is a product limit, not a technical one. The user can nest further by hand later. `ponytail:` the cap is the ceiling; lift it when we see real subjects that need deeper auto-structure.

## Concurrency

A secondary source on Notion's data model says that until 2025 Notion used last-write-wins per block, and that text later moved to a CRDT because two humans edit the same sentence, including across block splits. Confidence: **medium** for the history, **low** for any detail we did not read in Notion's own engineering post. Source: [fictty, Notion data model](https://fictty.com/data-model/notion/).

Our writers are the user and one model turn at a time. v1 is last-write-wins per block, inside a transaction for the whole operation list. We do not build a CRDT. The falsifier is a second simultaneous human editor. Until then a CRDT is complexity without a user.

User edits win ties against a model turn that started before the edit. The turn carries the block version it saw. If the version mismatches, that one operation is dropped and reported ("this section changed while the answer was writing"). The rest of the list still applies. We do not retry by overwriting the user's sentence.

## Session → note update

After the assistant text is complete:

1. Build a compact outline: page titles, heading block ids, and a one-line excerpt. Not the full tree.
2. Ask for JSON operations against that outline plus the new answer. Provider structured output or a JSON schema, not a hope that the model prints valid JSON. A clinical-note paper found JSON more parseable than YAML or XML for smaller models, and parseability still fell on long inputs. Confidence: **medium** (one paper, clinical notes, not our prompts). Source: [ACL 2025 SRW, structured output robustness](https://aclanthology.org/2025.acl-srw.19.pdf). We still validate. Parseable JSON can be semantically wrong.
3. Reject unknown ops and unknown block types. Apply the rest in one transaction.
4. One repair attempt if the payload does not parse. If repair fails, keep the chat and surface "notes not updated."

Operation list cap: 20 blocks per turn. A model that "reorganizes the whole subject" in one answer is the failure mode this cap stops. The user can ask for a reorganization as its own turn later.

## Flashcards

### What a card is for

One card per topic the session actually discussed, not one card per paragraph. A topic is the heading or concept the note update touched. Cap new cards at 3 per turn. ObsidianKi defaults to 6 cards per run and treats that as a knob, which supports "a small number," not "every sentence." Confidence: **medium** (project default, not a study). Source: [ObsidianKi](https://github.com/ccmdi/obsidianki).

Card body stays short. Front is a question. Back is the answer in the user's words as much as the source allows. LaTeX is allowed on either side and rendered with the same KaTeX component as notes.

### Create, update, or skip

Exact-match dedupe is not enough. anki-llm compares the first field exactly and says so: paraphrases and spelling variants pass through. Confidence: **high** that this is their behavior (their docs). Source: [anki-llm generate](https://anki-llm.raine.dev/generate/).

Embedding dedupe exists in the wild and is dangerous at a low threshold. ObsidianKi's vector dedupe defaults off, with an example threshold of 0.7. A lecture-note generator defaults dedupe off and, when on, uses cosine 0.95 because a lower bar drops cards that only look similar ("primary receptor" vs "co-receptor"). Confidence: **medium** (authors' stated tradeoff, not a benchmark we ran). Sources: [ObsidianKi](https://github.com/ccmdi/obsidianki), [anki-llm-flashcard-generator](https://github.com/mauroforlin/anki-llm-flashcard-generator).

Decision, in order:

1. Normalize the topic key (lowercase, strip punctuation, collapse whitespace).
2. Exact key hit inside the project deck → do not create. Go to the judge.
3. Else, if an embedding exists, take the nearest card. Cosine **≥ 0.92** → same topic, go to the judge. Below 0.92 → create.
4. The judge is a short structured call with the old card and the new fact. It returns `update` or `skip`, and on update a new front and back. It cannot delete a card.
5. No embedding key configured → exact key only. Near-duplicates can appear until an embedding provider is set. That is an honest degradation, not a silent merge.

0.92 sits between "0.7 merges different facts" and "0.95 only catches near-copies." It is a **starting threshold, not a measured optimum**. The falsifier is a labeled set of (new fact, existing card, should-merge) pairs from our own sessions. Until that set exists, we would rather create a duplicate than overwrite a card with a different fact. The judge is the safety check on the 0.92 band. Creates below 0.92 do not call the judge, which is the cost cut.

Skip means the existing back already covers the new fact. Update means the back is wrong, incomplete, or now has a better formulation. Scheduling state (FSRS stability, due date) is kept across an update. Rewriting a card must not reset the user to day zero. If the front changes so much that it is a different question, the judge should have returned a create instead; the prompt says that. We still do not auto-delete the old card.

### Scheduling

Review uses FSRS, the scheduler Anki ships as an option since 23.10, with an MIT Python package (`fsrs` on PyPI) and a TypeScript package (`ts-fsrs`). Sources: [fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki), [py-fsrs](https://pypi.org/project/fsrs/), [awesome-fsrs](https://github.com/open-spaced-repetition/awesome-fsrs). Confidence: **high** that the algorithm and the libraries exist. We have not reproduced their benchmark.

v1 scheduling lives on the server next to the card row, using `fsrs` (Python), so the web client cannot drift from the stored due time. Ratings are again / hard / good / easy. Parameter optimization from review logs waits until a user has enough reviews. Default FSRS weights until then. SM-2 is rejected because we would be implementing the older algorithm while the maintained one is a dependency we already accept.

The review UI is a separate surface from the chat: one card, show answer, rate. It is not a chat trick. Spaced-repetition tools that bury the card inside a conversation make the rating ambiguous (did the user rate, or did the model?). spacedrep's agent loop even has the agent pick the rating, which is the wrong product for a person studying. Source: [spacedrep](https://github.com/wpwilson10/spacedrep). We show the card. The user rates.

### What we rejected

| Option | Why it lost |
| --- | --- |
| Store notes as one markdown blob per project | Whole-document rewrites, no stable ids, bad partial updates. |
| One card per assistant message | Deck fills with "summarize this answer" cards. Topics repeat across sessions. |
| Always call the model to decide duplicate vs new | Every turn pays a generation to learn "no." Exact key and cosine run first. |
| Auto-delete stale cards | Irreversible. The user archives. |
| CRDT in v1 | No second human editor. |
| Anki as the database | We need cards inside the same transaction as notes. Export to `.apkg` can be a later adapter. FSRS does not require Anki's schema. |

## What would change this

- Users constantly fix a block the model replaced. Then show a diff and require accept, instead of applying `replace` immediately. Inserts can stay automatic.
- Duplicate-card complaints with cosine just under 0.92, or overwritten cards just over it. Move the threshold. Do not remove the judge.
- Review logs large enough to optimize FSRS weights per user. Until then defaults.
