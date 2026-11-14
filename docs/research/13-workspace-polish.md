# 13 — Workspace polish (layout + chat order)

Date: 2026-11-14.

## Question

Which small shell features make a three-pane study app feel finished without adding folders, accounts, or a second product surface.

## What peers do

| Peer | Pattern | Confidence | Source |
| --- | --- | --- | --- |
| Notion | Sidebar customize: show/hide, **drag reorder** shortcuts/sections; hide ≠ delete | High | [Notion sidebar help](https://www.notion.com/help/customize-your-sidebar) |
| ChatGPT ecosystem | **Pin** chats to top; folders/tags via extensions when native is thin | Medium | [AI Toolbox pins](https://www.ai-toolbox.co/features), [Chaturai](https://chromewebstore.google.com/detail/chatgpt-search-folders-ex/kehohalijgkilbmdiiidbmfokdbjappf) |
| VS Code | Persist **sidebar/panel sizes and visibility** across sessions; min sizes; collapse | High | [VS Code UI](https://code.visualstudio.com/docs/editing/getting-started/userinterface), layout persistence issues |
| Discord / Primer | Pointer drag **and** keyboard grab → arrows → drop; Escape cancel; **aria-live** | High | [Discord accessible DnD](https://support.discord.com/hc/en-us/articles/4408877527703-Accessible-Drag-and-Drop-FAQ), [Primer DnD](https://www.primer.style/accessibility/patterns/drag-and-drop/) |
| Slack | Region navigation (F6); do not rely on pointer alone | Medium | [Slack Design a11y](https://slack.design/articles/what-weve-learned-about-designing-for-accessibility-from-our-users/) |
| shadcn Resizable | `react-resizable-panels`: min/max, collapse, persist | Medium | [ReUI / shadcn Resizable](https://reui.io/components/resizable) |

## Decision for tidyai

Ship one **workspace-layout** slice and one **chat-order** slice. Both stay client prefs (one browser, BYOK vault already local). Do not add folders, archive, or server-side sort yet.

### A. Layout persistence + pane adjustment

| Subfeature | Spec |
| --- | --- |
| Persist open state | `sideOpen`, `notesOpen` in one `tidyai.layout` blob |
| Persist widths | Sidebar width (new) + notes width (existing) |
| Resize sidebar | Drag right edge; clamp 200–360; rail stays 56 when collapsed |
| Resize notes | Keep current handle; add keyboard nudge (←/→ while focused) |
| Double-click handle | Reset that pane to default width |
| Reset layout | Explicit control restores defaults (widths + both panes open on desktop) |
| Faults | Corrupt JSON → defaults; private mode → in-memory only; toast once on reset |

Rejected for this slice: full `react-resizable-panels` rewrite of the shell (couples chat + notes + sidebar into one grid, fights overlay rules under 960px). Extend the existing notes resize pattern. `ponytail:` if we later need nested splits, adopt shadcn Resizable for the desktop ≥960 path only.

### B. Chat ordering

| Subfeature | Spec |
| --- | --- |
| Pin | Pin/unpin per chat; pinned block stays above unpinned |
| Manual order | Reorder within pinned block and within unpinned block |
| Pointer | Drag handle (grip) on chat row; drop indicator line |
| Keyboard | Focus handle → Space/Enter grab → ↑/↓ move → Space/Enter drop → Esc cancel |
| Announce | `aria-live` polite: grab, position N of M, dropped/cancelled |
| Undo | Sonner action undoes last reorder for ~8s |
| Sort menu | Recent (created_at API order) vs Manual (prefs). Alphabetical deferred |
| Orphans | Unknown chat ids in prefs dropped on load; new chats append |

Storage: `tidyai.chatOrder.${projectId}` → `{ mode: "recent"\|"manual", pinned: string[], order: string[] }`.

Rejected: server `sort_position` until a second device or export needs it. Rejected: folders (ChatGPT extension pattern) — subjects already group chats.

### C. Rename chat (completes order UX)

Untitled → first-turn rename already exists. Manual rename via row menu needs `PATCH /v1/chats/{id}` with `{ title }`. Without rename, pin/order is incomplete.

## Module boundaries

| Module | Owns | Must not |
| --- | --- | --- |
| `lib/layout-prefs.ts` | Load/save/clamp layout blob | Know React or chats |
| `lib/chat-order.ts` | Pin/order/sort pure functions + storage | Know DOM drag |
| `components/resize-handle.tsx` | Pointer + keyboard resize chrome | Own storage keys |
| `components/chat-list.tsx` | Render + reorder UX | Call turn API |
| `apps/web` App | Wire prefs into shell | Inline reorder math |
| `services/api` | PATCH chat title | Store pin/order |

## What would overturn this

- Multi-device sync of layout/order → move prefs to Postgres user settings (still no accounts today).
- Long chat lists (>50/subject) → virtualize list; keep same order model.
- Need nested splits (chat | notes | cards) → shadcn Resizable desktop grid.
