/** Soft palette from the workspace preview (lime / lilac / coral). */
const DOTS = ["#b9ff66", "#c6a6ff", "#ff8c69", "#e2d8ff", "#9ad06a"] as const;

export function subjectDot(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return DOTS[hash % DOTS.length];
}
