# 01 — Chat interface

Question: what layout, motion, and color make a study chat usable for long sessions, with notes beside the thread, without inventing a visual system from scratch.

## What we looked at

Claude's current web app is the closest reference, because it already solved "conversation plus a durable thing beside it."

- The screen is three regions: a left sidebar (new chat, search, projects, recents), a center thread with a composer, and an optional right pane. Confidence: **medium**. The region list is repeated by a product tour and by Anthropic's own artifact help, which says an artifact opens beside the conversation. Sources: [Claude interface tour](https://kindatechnical.com/claude-ai/the-claude-ai-web-interface-a-complete-tour.html), [Artifacts help](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them).
- Artifacts exist because chat prose is a bad container for a document you keep editing. The thread stays the reasoning trail. The right pane stays the deliverable. Opening the pane must not destroy the thread. Confidence: **medium**. Source: [Claude artifacts UX teardown](https://aiuxplayground.com/teardowns/claude/artifacts) (updated 2026-06-14). Anthropic's help page agrees the artifact opens beside the chat and can be found again from the sidebar.
- A SaaSFrame teardown (July 2026, author says the numbers are DOM approximations, not a brand spec) reports sidebar 260px, collapsed rail about 56px, chat column max about 768px, panel animation about 200ms, hover about 150ms, 4px spacing base, warm neutrals, one accent used for primary actions and focus. Confidence: **low** as exact pixels, **medium** as a pattern. Source: [SaaSFrame Claude record](https://www.saasframe.io/saas/claude).

ChatGPT's classic layout is the same skeleton (sidebar + centered thread + bottom composer) without a durable right pane. We did not find a reason to copy a single full-width transcript. A study app's durable object is the note, so the Claude split is the better pattern.

## Arguments

**Center the transcript, do not stretch it.** Lines much past ~70–80 characters are harder to track. 768px is the figure reported for Claude's thread. We adopt it as a cap on the message column, not on the pane. The pane can be wider; the text column stays capped and centered. If a later readability pass disagrees, change the token, not the pane structure.

**Right pane is the notes, and it is optional.** On a short viewport the split gets cramped. The teardown says mobile needs a full-screen fallback. Decision: below 960px, notes become an overlay the user opens, not a third column. Chat stays usable. We will not ship three squeezed columns.

**Sidebar collapses to a rail, it does not unmount.** Unmounting loses scroll position in the project list. Width animation keeps the list mounted and hides labels. Collapsed icons need a text name (tooltip or `aria-label`). UCL's sidebar guidance: collapsed content must not stay in the tab order, target size at least 44px, contrast at least 4.5:1, do not rely on the icon alone. Source: [UCL side bar](https://www.ucl.ac.uk/brand-and-experience/experience/ucl-design-system/components/side-bar).

**One accent.** Claude's observed UI uses coral for primary actions, links, and focus, and warm gray everywhere else. A study tool should look quieter than a marketing page. Status (error, success) can use color, but never color alone.

## Motion

Material's duration guidance, which is a published system and not a vibe:

- Things that leave or collapse are shorter than things that enter. A navigation drawer is described at about 250ms open and 200ms close (Material 2). Material 3's "standard accelerate" exit default is 200ms; enter is longer. Sources: [Material 2 speed](https://m2.material.io/guidelines/motion/duration-easing.html), [Material 3 easing and duration](https://m3.material.io/styles/motion/easing-and-duration/applying-easing-and-duration).
- UCL's sidebar spec uses 260ms expand and 200ms collapse, ease-in-out. Close enough to Material that we do not need a third system.

Decision:

| Motion | Duration | Easing |
| --- | --- | --- |
| Sidebar and notes open | 250ms | cubic-bezier(0.2, 0, 0, 1) |
| Sidebar and notes close | 200ms | cubic-bezier(0.3, 0, 1, 1) |
| Hover / color | 150ms | ease |

`prefers-reduced-motion: reduce` sets those transitions to none. MDN: the preference means non-essential motion should stop; the value is `reduce`, and it is not a license to delete focus indicators. Source: [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using_for_accessibility).

We animate width and opacity only. No sliding the whole transcript on every token. Streaming text is already motion.

## Color — 60 / 30 / 10

The 60-30-10 split is a composition heuristic from interior design, reused in UI writing. It is not a usability standard and not a pixel quota. Sources: [LogRocket](https://blog.logrocket.com/ux-design/60-30-10-rule/), [Mockitt](https://mockitt.com/ui-ux-design/60-30-10-color-rule.html), [Vision Australia](https://www.visionaustralia.org/business-consulting/digital-access/Creating-accessible-digital-colour-palettes-60-30-10-design-rule). Mockitt and Vision Australia both say the same caveat we adopt: check contrast, do not paint extra accents just to hit 10%.

| Role | Share | Use | Token |
| --- | --- | --- | --- |
| Dominant | ~60% | Page and chat canvas | `--bg #F7F5F2` |
| Secondary | ~30% | Sidebar, notes pane, composer well | `--surface #E7E1D8` |
| Accent | ~10% | Primary button, current nav, focus ring | `--accent #9A3412` |

Warm neutrals, not cool gray. That matches the Claude observation and keeps long reading less clinical. Ink is `#1C1917`. Secondary text is `#57534E`, not a lighter stone.

Contrast computed in this repo on 2026-11-06 (WCAG relative luminance):

| Pair | Ratio | Verdict |
| --- | --- | --- |
| `#1C1917` on `#F7F5F2` | 16.07 | body text |
| `#1C1917` on `#E7E1D8` | 13.46 | text on panels |
| `#57534E` on `#F7F5F2` | 7.01 | secondary text |
| `#78716C` on `#F7F5F2` | 4.41 | rejected, under 4.5:1 |
| `#9A3412` on `#F7F5F2` | 6.71 | accent text and links |
| `#FFFFFF` on `#9A3412` | 7.31 | button label |

WCAG 2.2 still asks 4.5:1 for normal text and 3:1 for large text and for UI boundaries that convey state. We are not claiming a full audit. We are claiming these pairs pass the text ratio.

Dark mode is not in v1. A navy background is a different palette, not an invert. Shipping a bad invert would violate the contrast work above.

## Composer and thread

- Composer is a multi-line field pinned to the bottom of the center pane. Enter sends. Shift+Enter inserts a newline. This is the pattern people already have from Claude and ChatGPT. We did not find a study that says a send button alone is better, so we keep both the key and the button.
- User and assistant messages are full-width within the column, not alternating comic bubbles. Bubbles waste horizontal space once answers contain tables and formulas. Role is a label, plus a background tint on the user message only.
- The model picker sits in the composer, not in a global header. BYOK means the model list is whatever that user's key can call. A global "the" model would be a lie.
- Streaming shows the assistant message growing in place. A caret at the end is optional and must disappear under reduced motion. We do not animate each token with a bounce.

## What we rejected

| Option | Why it lost |
| --- | --- |
| Chat only, notes on another route | The session and the note are one activity. A route change hides the thing the answer is updating. |
| Notes on the left, chat on the right | Sidebar already owns navigation. Putting notes there mixes "where am I" with "what did we learn." |
| Always-on right pane | Empty notes on a new project waste the reading column. Pane opens when the project has notes or the user asks. |
| Cool gray + purple gradient | Fights the 10% accent rule and ages like a template. |
| Motion on every token | Competes with reading. Width animation is for panels the user toggled. |

## What would change this

- A readability test with our own transcripts showing a better measure than 768px.
- A phone layout test showing the overlay notes pattern fails (people never reopen notes). Then notes need a persistent handle, not a hidden panel.
- A contrast failure after a brand color change. Recompute the table. Do not eyeball it.
