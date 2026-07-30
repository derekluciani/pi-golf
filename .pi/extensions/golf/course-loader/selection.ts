import { isAbsolute, resolve } from "node:path";

import { loadPreviewCourse } from "../courses/index.ts";
import {
  loadSelectableCourseFile,
  type CourseLoadIssue,
  type LoadedCourseFile,
} from "./loading.ts";
import {
  PREVIEW_COURSE_ID,
  PREVIEW_COURSE_SETTINGS,
  PREVIEW_COURSE_SOURCE,
  readCourseSettings,
  writeCourseSettings,
  type CourseSettings,
  type CourseSettingsIssue,
} from "./settings.ts";
import type { Course, CourseWarning } from "./types.ts";

export type CourseSelectionWarningCode =
  | "selected-course-id-mismatch"
  | "selected-course-unavailable";

export interface CourseSelectionWarning {
  readonly code: CourseSelectionWarningCode;
  readonly sourcePath: string;
  readonly message: string;
  readonly loadIssue: CourseLoadIssue | undefined;
}

export interface SelectedCourseSnapshot {
  /** Fresh, deeply frozen validated input for a future Round start. */
  readonly course: Course;
  readonly sourcePath: string;
  readonly usedPreviewFallback: boolean;
  readonly warnings: readonly (CourseSettingsIssue | CourseSelectionWarning)[];
  readonly courseWarnings: readonly CourseWarning[];
}

export type ExplicitCourseSelectionResult =
  | {
      readonly ok: true;
      readonly selected: LoadedCourseFile;
      readonly settings: CourseSettings;
    }
  | {
      readonly ok: false;
      readonly sourcePath: string;
      readonly issue: CourseLoadIssue;
    };

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

async function previewSnapshot(
  warnings: readonly (CourseSettingsIssue | CourseSelectionWarning)[],
  usedPreviewFallback: boolean,
): Promise<SelectedCourseSnapshot> {
  const preview = await loadPreviewCourse();
  return {
    course: deepFreeze(preview.course),
    sourcePath: PREVIEW_COURSE_SOURCE,
    usedPreviewFallback,
    warnings,
    courseWarnings: preview.warnings,
  };
}

/**
 * Resolves the persisted selection into an isolated validated snapshot. This is
 * the only seam future Round-start code needs; no active Round is retained here.
 */
export async function captureSelectedCourseSnapshot(cwd: string): Promise<SelectedCourseSnapshot> {
  const persisted = await readCourseSettings(cwd);
  const warnings: (CourseSettingsIssue | CourseSelectionWarning)[] = [];
  if (persisted.warning !== undefined) warnings.push(persisted.warning);

  if (persisted.warning !== undefined) return previewSnapshot(warnings, true);
  if (persisted.settings.sourcePath === PREVIEW_COURSE_SOURCE) {
    if (persisted.settings.selectedCourseId === PREVIEW_COURSE_ID) {
      return previewSnapshot(warnings, false);
    }
    warnings.push({
      code: "selected-course-id-mismatch",
      sourcePath: PREVIEW_COURSE_SOURCE,
      message: "Persisted Preview Course ID does not match its source; using Preview Course.",
      loadIssue: undefined,
    });
    return previewSnapshot(warnings, true);
  }

  const loaded = await loadSelectableCourseFile(persisted.settings.sourcePath);
  if (!loaded.ok) {
    warnings.push({
      code: "selected-course-unavailable",
      sourcePath: persisted.settings.sourcePath,
      message: `Selected Course is unavailable; using Preview Course: ${persisted.settings.sourcePath}`,
      loadIssue: loaded.issue,
    });
    return previewSnapshot(warnings, true);
  }
  if (loaded.value.course.id !== persisted.settings.selectedCourseId) {
    warnings.push({
      code: "selected-course-id-mismatch",
      sourcePath: persisted.settings.sourcePath,
      message: `Selected Course ID changed from ${JSON.stringify(persisted.settings.selectedCourseId)} to ${JSON.stringify(loaded.value.course.id)}; using Preview Course.`,
      loadIssue: undefined,
    });
    return previewSnapshot(warnings, true);
  }

  return {
    course: deepFreeze(loaded.value.course),
    sourcePath: loaded.value.sourcePath,
    usedPreviewFallback: false,
    warnings,
    courseWarnings: loaded.value.warnings,
  };
}

/** Validates first and only then atomically replaces the persisted selection. */
export async function selectCourseFromPath(
  cwd: string,
  suppliedPath: string,
): Promise<ExplicitCourseSelectionResult> {
  const suppliedAbsolutePath = isAbsolute(suppliedPath) ? resolve(suppliedPath) : resolve(cwd, suppliedPath);
  const loaded = await loadSelectableCourseFile(suppliedAbsolutePath);
  if (!loaded.ok) return { ok: false, sourcePath: suppliedAbsolutePath, issue: loaded.issue };
  // loadSelectableCourseFile's stable read is the authority for canonical identity.
  const settings: CourseSettings = {
    selectedCourseId: loaded.value.course.id,
    sourcePath: loaded.value.sourcePath,
  };
  await writeCourseSettings(cwd, settings);
  return { ok: true, selected: loaded.value, settings };
}

/**
 * Commits either Preview or a catalog option. A catalog record is display-time
 * data only: reload its source at this exported commit boundary so replacement
 * cannot persist stale identity or bytes.
 */
export async function selectLoadedCourse(
  cwd: string,
  selected: LoadedCourseFile | "preview",
): Promise<CourseSettings> {
  if (selected === "preview") {
    await writeCourseSettings(cwd, PREVIEW_COURSE_SETTINGS);
    return PREVIEW_COURSE_SETTINGS;
  }

  const fresh = await loadSelectableCourseFile(selected.sourcePath);
  if (!fresh.ok) {
    throw new Error(`Cannot select Course: ${fresh.issue.message}`);
  }
  const settings: CourseSettings = {
    selectedCourseId: fresh.value.course.id,
    sourcePath: fresh.value.sourcePath,
  };
  await writeCourseSettings(cwd, settings);
  return settings;
}
