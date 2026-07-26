import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import { isReservedBuiltInCourseId } from "./settings.ts";
import { parseCourse } from "./validation.ts";
import type { Course, CourseDiagnostic, CourseWarning } from "./types.ts";

export type CourseLoadIssueCode =
  | "course-warning"
  | "duplicate-course-id"
  | "invalid-course"
  | "malformed-json"
  | "reserved-course-id"
  | "unreadable-course"
  | "unreadable-directory";

export interface CourseLoadIssue {
  readonly code: CourseLoadIssueCode;
  readonly sourcePath: string;
  readonly message: string;
  readonly diagnostics: readonly CourseDiagnostic[];
  readonly warnings: readonly CourseWarning[];
}

export interface LoadedCourseFile {
  readonly course: Course;
  readonly sourcePath: string;
  readonly warnings: readonly CourseWarning[];
}

export type CourseFileLoadResult =
  | { readonly ok: true; readonly value: LoadedCourseFile }
  | { readonly ok: false; readonly issue: CourseLoadIssue };

export interface CourseDiscoveryResult {
  readonly courses: readonly LoadedCourseFile[];
  readonly warnings: readonly CourseLoadIssue[];
}

function issue(
  code: CourseLoadIssueCode,
  sourcePath: string,
  message: string,
  diagnostics: readonly CourseDiagnostic[] = [],
  warnings: readonly CourseWarning[] = [],
): CourseLoadIssue {
  return { code, sourcePath, message, diagnostics, warnings };
}

/** Reads, parses, and validates one external Course without trusting any file content. */
export async function loadCourseFile(sourcePath: string): Promise<CourseFileLoadResult> {
  let text: string;
  try {
    text = await readFile(sourcePath, "utf8");
  } catch {
    return {
      ok: false,
      issue: issue("unreadable-course", sourcePath, `Cannot read Course file: ${sourcePath}`),
    };
  }

  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      issue: issue("malformed-json", sourcePath, `Malformed JSON in Course file: ${sourcePath}`),
    };
  }

  const validation = parseCourse(input);
  if (!validation.ok) {
    return {
      ok: false,
      issue: issue(
        "invalid-course",
        sourcePath,
        `Invalid Course file: ${sourcePath}`,
        validation.errors,
        validation.warnings,
      ),
    };
  }

  if (isReservedBuiltInCourseId(validation.value.id)) {
    return {
      ok: false,
      issue: issue(
        "reserved-course-id",
        sourcePath,
        `Course ID ${JSON.stringify(validation.value.id)} is reserved by built-in content; choose a different Course ID.`,
      ),
    };
  }

  return {
    ok: true,
    value: { course: validation.value, sourcePath, warnings: validation.warnings },
  };
}

interface WalkResult {
  readonly files: string[];
  readonly warnings: CourseLoadIssue[];
}

async function findJsonFiles(directory: string, missingIsEmpty = false): Promise<WalkResult> {
  const files: string[] = [];
  const warnings: CourseLoadIssue[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const missing = error instanceof Error
      && "code" in error
      && (error as NodeJS.ErrnoException).code === "ENOENT";
    if (!missing || !missingIsEmpty) {
      warnings.push(issue(
        "unreadable-directory",
        directory,
        `Cannot read Course discovery directory: ${directory}`,
      ));
    }
    return { files, warnings };
  }

  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findJsonFiles(entryPath);
      files.push(...nested.files);
      warnings.push(...nested.warnings);
    } else if ((entry.isFile() || entry.isSymbolicLink()) && extname(entry.name).toLowerCase() === ".json") {
      files.push(entryPath);
    }
  }
  return { files, warnings };
}

function duplicateIdIssues(
  discoveryDirectory: string,
  courses: readonly LoadedCourseFile[],
): { readonly courses: LoadedCourseFile[]; readonly warnings: CourseLoadIssue[] } {
  const byId = new Map<string, LoadedCourseFile[]>();
  for (const course of courses) {
    const matches = byId.get(course.course.id) ?? [];
    matches.push(course);
    byId.set(course.course.id, matches);
  }

  const selectable: LoadedCourseFile[] = [];
  const warnings: CourseLoadIssue[] = [];
  for (const course of courses) {
    const matches = byId.get(course.course.id) ?? [];
    if (matches.length === 1) {
      selectable.push(course);
      continue;
    }
    const sources = matches
      .map((match) => relative(discoveryDirectory, match.sourcePath))
      .sort()
      .join(", ");
    warnings.push(issue(
      "duplicate-course-id",
      course.sourcePath,
      `Course ID ${JSON.stringify(course.course.id)} conflicts with multiple files (${sources}); this file is not selectable.`,
    ));
  }
  return { courses: selectable, warnings };
}

/**
 * Recursively discovers JSON files in stable path order. A missing root is an
 * empty custom list; every other file/directory failure remains a warning.
 */
export async function discoverCourses(discoveryDirectory: string): Promise<CourseDiscoveryResult> {
  const walked = await findJsonFiles(discoveryDirectory, true);
  const loaded: LoadedCourseFile[] = [];
  const warnings = [...walked.warnings];

  for (const sourcePath of walked.files) {
    const result = await loadCourseFile(sourcePath);
    if (!result.ok) {
      warnings.push(result.issue);
      continue;
    }
    loaded.push(result.value);
    if (result.value.warnings.length > 0) {
      warnings.push(issue(
        "course-warning",
        sourcePath,
        `Course validator warnings for: ${sourcePath}`,
        [],
        result.value.warnings,
      ));
    }
  }

  const deduplicated = duplicateIdIssues(discoveryDirectory, loaded);
  return {
    courses: deduplicated.courses,
    warnings: [...warnings, ...deduplicated.warnings],
  };
}

/** Formats stable, path-aware warning text for commands and the settings UI. */
export function formatCourseLoadIssue(value: CourseLoadIssue): string {
  const details = [
    ...value.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`),
    ...value.warnings.map((warning) => `${warning.path}: ${warning.message}`),
  ];
  return details.length === 0 ? value.message : `${value.message}\n${details.join("\n")}`;
}
