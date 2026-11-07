export type StudyMode = "notes" | "web";

const PREFIX = "tidyai.studyMode.";

export function loadStudyMode(chatId: string): StudyMode {
  if (!chatId) return "web";
  try {
    return localStorage.getItem(PREFIX + chatId) === "notes" ? "notes" : "web";
  } catch {
    return "web";
  }
}

export function saveStudyMode(chatId: string, mode: StudyMode): void {
  if (!chatId) return;
  try {
    localStorage.setItem(PREFIX + chatId, mode);
  } catch {
    // Private mode can refuse writes.
  }
}
