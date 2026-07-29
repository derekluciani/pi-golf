import { MAX_COURSE_DIAGNOSTICS } from "./schema.ts";
import type { CourseWarning } from "./types.ts";

function compare(left: string | number, right: string | number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Presentation wording is intentionally excluded from warning identity. */
export function canonicalizeCourseWarnings(candidates: readonly CourseWarning[]): readonly CourseWarning[] {
  const unique = new Map<string, CourseWarning>();
  for (const warning of candidates) {
    const key = JSON.stringify([
      warning.sourcePath ?? "", warning.code, warning.path,
      warning.courseIndex ?? 0, warning.holeIndex ?? 0, warning.regionIndex ?? 0,
    ]);
    if (!unique.has(key)) unique.set(key, warning);
  }
  const sorted = [...unique.values()].sort((a, b) =>
    compare(a.sourcePath ?? "", b.sourcePath ?? "") || compare(a.code, b.code)
    || compare(a.path, b.path) || compare(a.courseIndex ?? 0, b.courseIndex ?? 0)
    || compare(a.holeIndex ?? 0, b.holeIndex ?? 0) || compare(a.regionIndex ?? 0, b.regionIndex ?? 0));
  if (sorted.length <= MAX_COURSE_DIAGNOSTICS) return sorted;
  return [...sorted.slice(0, MAX_COURSE_DIAGNOSTICS - 1), {
    path: "$", code: "diagnostics-truncated", message: `${sorted.length - MAX_COURSE_DIAGNOSTICS + 1} warnings omitted.`,
  }];
}
