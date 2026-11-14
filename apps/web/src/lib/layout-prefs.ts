/** Persist shell layout. Corrupt or private-mode storage falls back to defaults. */

import { clampNotesWidth, NOTES_WIDTH_DEFAULT, NOTES_WIDTH_MAX, NOTES_WIDTH_MIN } from "./notes-width";

const KEY = "tidyai.layout";

export const SIDEBAR_WIDTH_DEFAULT = 245;
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 360;
export const SIDEBAR_RAIL = 56;

export type LayoutPrefs = {
  sideOpen: boolean | null;
  notesOpen: boolean | null;
  sidebarWidth: number;
  notesWidth: number;
};

export const LAYOUT_DEFAULTS: LayoutPrefs = {
  sideOpen: null,
  notesOpen: null,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  notesWidth: NOTES_WIDTH_DEFAULT,
};

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
}

function desktopDefaultOpen(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 960px)").matches;
}

export function loadLayoutPrefs(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return {
        ...LAYOUT_DEFAULTS,
        notesWidth: clampNotesWidth(
          (() => {
            try {
              const legacy = localStorage.getItem("tidyai.notesWidth");
              return legacy ? Number(legacy) : NOTES_WIDTH_DEFAULT;
            } catch {
              return NOTES_WIDTH_DEFAULT;
            }
          })(),
        ),
      };
    }
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>;
    return {
      sideOpen: typeof parsed.sideOpen === "boolean" ? parsed.sideOpen : null,
      notesOpen: typeof parsed.notesOpen === "boolean" ? parsed.notesOpen : null,
      sidebarWidth: clampSidebarWidth(
        typeof parsed.sidebarWidth === "number" ? parsed.sidebarWidth : SIDEBAR_WIDTH_DEFAULT,
      ),
      notesWidth: clampNotesWidth(
        typeof parsed.notesWidth === "number" ? parsed.notesWidth : NOTES_WIDTH_DEFAULT,
      ),
    };
  } catch {
    return { ...LAYOUT_DEFAULTS };
  }
}

export function saveLayoutPrefs(prefs: LayoutPrefs): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        sideOpen: prefs.sideOpen,
        notesOpen: prefs.notesOpen,
        sidebarWidth: clampSidebarWidth(prefs.sidebarWidth),
        notesWidth: clampNotesWidth(prefs.notesWidth),
      }),
    );
  } catch {
    // Private mode can refuse writes.
  }
}

export function resolvePaneOpen(stored: boolean | null): boolean {
  return stored === null ? desktopDefaultOpen() : stored;
}

export function resetLayoutPrefs(): LayoutPrefs {
  const next: LayoutPrefs = {
    sideOpen: true,
    notesOpen: true,
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    notesWidth: NOTES_WIDTH_DEFAULT,
  };
  saveLayoutPrefs(next);
  return next;
}

export { NOTES_WIDTH_DEFAULT, NOTES_WIDTH_MIN, NOTES_WIDTH_MAX, clampNotesWidth };
