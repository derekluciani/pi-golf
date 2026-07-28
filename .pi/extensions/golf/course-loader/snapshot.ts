import { parseCourseJson } from "./raw-parser.ts";
import type { Course, RoundCourseSnapshot } from "./types.ts";

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

/**
 * Fresh-read seam used at Round start. The returned serialized graph is intended
 * for the single round-start entry; future Shot entries retain only its identity.
 */
export async function createRoundCourseSnapshot(
  readSelectedSource: () => Promise<string | Uint8Array>,
): Promise<RoundCourseSnapshot> {
  const result = parseCourseJson(await readSelectedSource());
  if (!result.ok) throw new Error("Selected Course is invalid", { cause: result.errors });
  const clone = structuredClone(result.value) as Course;
  const serializedCourse = JSON.stringify(clone);
  return deepFreeze({ course: deepFreeze(clone), serializedCourse });
}
