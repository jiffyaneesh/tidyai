# 12 — Fault-tolerant study UX

Date: 2026-11-09.

## Problem

Today many failures land as a single red banner or raw fetch text (`Failed to fetch`). Users can still click Send with no provider, no chat, or DB down, then get an opaque error. Notes save failures sit inline without a global signal.

## Principles (locked)

1. **Prevent before punish.** If an action cannot succeed, disable the control and say why nearby (composer hint, tooltip). Do not wait for the network round-trip.
2. **Banner = blocking state.** Database down stays a sticky banner with Retry. It is not a toast; it must survive until fixed.
3. **Toast = transient outcome.** Save ok, save fail, turn error, copy ok, settings saved. Auto-dismiss. User can keep studying.
4. **Plain language.** Map provider/API codes to one short sentence. Never show `TypeError`, stack traces, or raw JSON to the user.
5. **One recovery path.** Every error names the next click when there is one (Open settings, Retry, Reload notes).

## Toast library

| Option | For | Against |
| --- | --- | --- |
| **Sonner** | Tiny API, promise helper, theme-aware, shadcn default, Alt+T focus | Past live-region edge cases (maintainers aware) |
| react-hot-toast | Lightweight | Weaker SR announcements in practice |
| Radix Toast | Full primitives | Heavier; more wiring than we need |

**Decision: Sonner.** User asked for a reliable library; Sonner is the current shadcn path and fits a single-person study app. Keep `Toaster` theme synced to light/dark.

## Error surface map

| Event | Surface |
| --- | --- |
| DB health fail | Sticky banner + toast once on transition to down |
| No provider / no chat / empty draft | Disabled Send + composer hint |
| Turn SSE `error` | Toast (destructive) + keep chat |
| Abort | Soft toast / status, not error |
| Notes save fail | Inline Retry (keep) + toast |
| Settings validation | Inline in dialog (keep) + toast on successful save |
| Copy / create subject / create chat | Toast success or error |

## What would change this

- Multi-user / collaborative edits → need conflict toasts with Reload + merge.
- Offline-first → queue turns; toast "Will send when online."
