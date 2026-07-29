import { readFile } from "node:fs/promises";

import {
  parseCourseJson,
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
export async function loadPreviewCourse(
  readPreviewSource: () => Promise<string | Uint8Array> = async () => {
    const sourceUrl = new URL("./preview-course.json", import.meta.url);
    return readFile(sourceUrl);
  },
): Promise<LoadedPreviewCourse> {
  const validation = parseCourseJson(await readPreviewSource());
  if (!validation.ok) {
    throw new Error(`Bundled Preview Course is invalid: ${JSON.stringify(validation.errors)}`);
  }
  return {
    course: validation.value,
    raster: rasterizeCourse(validation.value),
    warnings: validation.warnings,
  };
}
