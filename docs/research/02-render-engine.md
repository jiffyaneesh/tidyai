# 02 — Render engine

Question: the product needs streaming text, markdown, formulas, tables, symbols, and interactive pieces. Does that mean we write a renderer?

## Short decision

No new markdown parser. Two renderers, one engine.

1. **Chat renderer.** An existing streaming markdown library draws the transcript.
2. **Note renderer.** Our components draw a block tree. Notes are data, not a markdown string.
3. **Study-turn engine.** Our code decides when the transcript is prose, when a fenced payload becomes an interactive block, and when a finished answer becomes note operations and card intents. That is the engine worth building. A parser is not.

## Why a homegrown parser loses

Every chat app hits the same bug: `react-markdown` reparses the whole document on every token. At high token rates, tables and code blocks flicker and the main thread drops frames. That complaint is the reason the streaming libraries exist. Source: [stream-md README](https://github.com/jvoltci/stream-md). The failure mode is real even if that repo's "300x" figure is **low** confidence (their benchmark, not ours).

What streaming actually requires, and what we would be reimplementing:

- Unterminated constructs (`**bo`, an open `$$`, a half-built table) must not throw and must not flash between parsed and raw.
- Closed blocks should not be re-highlighted on the next token.
- HTML in model output is an XSS hole. It has to be stripped or escaped.
- Math delimiters disagree (`$` vs `\(` vs `$$`).
- Tables are not valid until the separator row arrives.

Vercel Streamdown, stream-md, and incremark-renderer all exist to do this. Sources: [streamdown](https://github.com/vercel/streamdown/), [streamdown math](https://streamdown.ai/docs/plugins/math), [incremark-renderer](https://github.com/qingyunwy/incremark-renderer). Writing our own lexer would spend the project on a solved problem and would be the part most likely to be wrong.

## Which chat renderer

| | react-markdown | Streamdown | stream-md | incremark |
| --- | --- | --- | --- | --- |
| Incomplete markdown | poor | designed for it | designed for it | designed for it |
| GFM tables | plugin | built in | built in | via marked |
| KaTeX | plugin | `@streamdown/math` | optional plugin | built in |
| HTML hardening | plugin | `rehype-harden` | default URL sanitizer | sanitizes by default |
| Incremental parse claim | no | memoized blocks; still described as re-rendering more than stream-md | new tokens only; closed blocks frozen | re-lex stable blocks + tail |
| Who maintains it | remark org, huge use | Vercel, used by AI Elements | smaller project | smaller project |

stream-md's table claims incremental parse, memoized closed blocks, highlight-once, and a smaller bundle. Those claims are **low** until we profile them. Streamdown's streaming behavior and KaTeX incomplete-equation handling are documented with examples and sit next to the Vercel AI SDK, which we are not required to adopt but which is the boring React path. Confidence in "Streamdown can render streaming GFM + KaTeX and harden HTML": **medium-high** (official docs and a widely used library). Confidence that it is the fastest: **low**.

Decision: **Streamdown + `@streamdown/math` + code plugin, KaTeX CSS, no raw HTML.** If a profiler shows the open block re-rendering the whole message enough to miss frames, switch the chat component to stream-md. The message model does not change, so this swap is a component replacement, not a migration.

KaTeX over MathJax: Streamdown's math docs say KaTeX is about 2–3x faster. That specific multiple is a **vendor claim (low)**. The decision does not need the multiple. KaTeX is what the chosen library already integrates, and it outputs MathML, which is the accessibility path. We store LaTeX source, never the HTML KaTeX emits.

Symbols outside math are Unicode in the text node. No symbol font engine.

## Interactive elements

Model-authored HTML and arbitrary React are rejected. A model that can emit `<script>` or an `onClick` handler is an XSS bug, not a feature. Streamdown's hardening is the backstop for the transcript. It is not a component system.

Allowed interactive pieces are a closed set of note block types (see [03](03-notes-sessions-flashcards.md)): paragraph, heading, lists, to-do, equation, table, callout, toggle, divider, child page.

In the transcript, the model may emit a fenced block:

```tidyai
{"type":"equation","latex":"E=mc^2"}
```

Rules:

- Until the closing fence arrives, render it as a code fence. Do not `JSON.parse` partial JSON.
- After the fence closes, parse once. Unknown `type` stays as code. Known `type` swaps to the same React component the notes pane uses.
- The fence is a view. It is not the write path into the note tree. Note writes go through validated operations after the turn (next file). Otherwise a half-streamed fence could insert a broken block.

Tables in chat are GFM, rendered by Streamdown. Tables in notes are a `table` block with rows as data. Pipe-syntax is a bad storage format: one edited cell rewrites the whole grid and breaks the separator line.

## The engine we do build

`StudyTurnEngine` is application code, not a parse library. One turn:

1. Stream provider tokens into the assistant message as text.
2. The chat renderer paints that text, including unfinished markdown.
3. When the provider stream ends, run one structured call that returns note operations and card intents. This call does not stream into the document.
4. Validate operations against the block schema. Apply them in one database transaction, or apply none.
5. Reconcile cards (next file).
6. Tell the client the notes changed. The notes pane refetches. It does not merge token soup.

Why note updates are not streamed live:

- A block tree with stable ids cannot be built from a partial JSON array without flicker and rollback.
- Users read the answer while it streams. They look at notes when the answer is done. The teardown's point was that the deliverable is beside the thread, not that every token mutates the deliverable.
- A failed structured call can leave the chat intact and mark notes as not updated. If we had already mutated notes mid-stream, we would need undo.

Cost of this choice: notes lag the last token by one short structured call. That is acceptable. A spinner on the notes pane ("Updating notes") covers it.

## What would change this

- A measured frame drop with Streamdown on a long math-heavy answer, on a low-end laptop. Then try stream-md before writing a parser.
- A real need for a block type the fence schema cannot express. Add the type to the allowlist. Do not open raw HTML.
- Collaborative cursors inside a block. Out of scope. Notion moved text to a CRDT because two people edit the same sentence (see next file). We are one writer plus a model. Last-write-wins per block is enough until a second human cursor exists.
