import { readFile } from "node:fs/promises";

import {
  parseCourse,
  rasterizeCourse,
  type Course,
  type CourseWarning,
  type RasterizedCourse,
} from "../course-loader/index.ts";

export interface LoadedPreviewCourse {
  readonly course: Course;
  readonly raster: RasterizedCourse;
  readonly warnings: readonly CourseWarning[];
}

/**
 * Loads the editable built-in JSON as untrusted input, then uses the same public
 * parser and rasterizer available to custom Course callers.
 */
export async function loadPreviewCourse(): Promise<LoadedPreviewCourse> {
  const sourceUrl = new URL("./preview-course.json", import.meta.url);
  const input: unknown = JSON.parse(await readFile(sourceUrl, "utf8"));
  const validation = parseCourse(input);
  if (!validation.ok) {
    throw new Error(`Bundled Preview Course is invalid: ${JSON.stringify(validation.errors)}`);
  }
  return {
    course: validation.value,
    raster: rasterizeCourse(validation.value),
    warnings: validation.warnings,
  };
}
