import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

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

  return {
    ok: true,
    value: { course: validation.value, sourcePath, warnings: validation.warnings },
  };
}

/** Applies external selection identity policy after independent file validation. */
export async function loadSelectableCourseFile(sourcePath: string): Promise<CourseFileLoadResult> {
  const loaded = await loadCourseFile(sourcePath);
  if (!loaded.ok || !isReservedBuiltInCourseId(loaded.value.course.id)) return loaded;
  return {
    ok: false,
    issue: issue(
      "reserved-course-id",
      sourcePath,
      `Course ID ${JSON.stringify(loaded.value.course.id)} in ${sourcePath} is reserved by built-in content; choose a different Course ID.`,
    ),
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

/**
 * Recursively discovers and independently validates JSON files in stable path
 * order. Cross-source identity is retained for catalog-wide reconciliation.
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

  return {
    courses: loaded,
    warnings,
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
