const STORAGE_KEY = "tidyai.notesWidth";
export const NOTES_WIDTH_DEFAULT = 360;
export const NOTES_WIDTH_MIN = 280;
export const NOTES_WIDTH_MAX = 640;

export function loadNotesWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = raw ? Number(raw) : NOTES_WIDTH_DEFAULT;
    if (!Number.isFinite(value)) return NOTES_WIDTH_DEFAULT;
    return Math.min(NOTES_WIDTH_MAX, Math.max(NOTES_WIDTH_MIN, Math.round(value)));
  } catch {
    return NOTES_WIDTH_DEFAULT;
  }
}

export function saveNotesWidth(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Private mode can refuse writes.
  }
}

export function clampNotesWidth(width: number): number {
  return Math.min(NOTES_WIDTH_MAX, Math.max(NOTES_WIDTH_MIN, Math.round(width)));
}
