export type StudyStats = {
  searches: number;
  hits: number;
  noteSkips: number;
};

const KEY = "tidyai.studyStats";

const EMPTY: StudyStats = { searches: 0, hits: 0, noteSkips: 0 };

export function loadStudyStats(): StudyStats {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<StudyStats>;
    return {
      searches: Number(parsed.searches) || 0,
      hits: Number(parsed.hits) || 0,
      noteSkips: Number(parsed.noteSkips) || 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function bumpStudyStat(field: keyof StudyStats, by = 1): StudyStats {
  const current = loadStudyStats();
  const next = { ...current, [field]: current[field] + by };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode can refuse writes.
  }
  return next;
}
