import { relative } from "node:path";

import {
  formatCourseLoadIssue,
  type CourseDiscoveryResult,
  type LoadedCourseFile,
} from "./loading.ts";
import type {
  CourseSelectionWarning,
  SelectedCourseSnapshot,
} from "./selection.ts";
import {
  PREVIEW_COURSE_ID,
  PREVIEW_COURSE_SOURCE,
  type CourseSettingsIssue,
} from "./settings.ts";

export interface CourseCatalogOption {
  readonly label: string;
  readonly courseId: string;
  readonly sourcePath: string;
  readonly loaded: LoadedCourseFile | "preview";
}

export interface CourseCatalogWarning {
  readonly code: string;
  readonly sourcePath: string;
  readonly message: string;
}

export interface CourseCatalog {
  readonly options: readonly CourseCatalogOption[];
  readonly currentValue: string;
  readonly warnings: readonly CourseCatalogWarning[];
}

export interface CourseCatalogPreview {
  readonly label: string;
  readonly courseId: string;
  readonly sourcePath: string;
}

export const PREVIEW_COURSE_CATALOG: CourseCatalogPreview = {
  label: "Preview Course",
  courseId: PREVIEW_COURSE_ID,
  sourcePath: PREVIEW_COURSE_SOURCE,
};

export interface CourseCatalogInput {
  readonly preview: CourseCatalogPreview;
  readonly coursesDirectory: string;
  readonly discovery: CourseDiscoveryResult;
  readonly selectedSnapshot: SelectedCourseSnapshot;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCandidates(left: LoadedCourseFile, right: LoadedCourseFile): number {
  return compareText(left.sourcePath, right.sourcePath)
    || compareText(left.course.id, right.course.id)
    || compareText(left.course.name, right.course.name)
    || compareText(JSON.stringify(left.course), JSON.stringify(right.course));
}

function sourceLabel(coursesDirectory: string, sourcePath: string): string {
  const label = relative(coursesDirectory, sourcePath);
  return label.length === 0 ? sourcePath : label;
}

function selectionWarningText(warning: CourseSettingsIssue | CourseSelectionWarning): string {
  if ("settingsPath" in warning) return warning.message;
  if (warning.loadIssue === undefined) return warning.message;
  return `${warning.message}\n${formatCourseLoadIssue(warning.loadIssue)}`;
}

function createLabels(
  coursesDirectory: string,
  previewLabel: string,
  courses: readonly LoadedCourseFile[],
): readonly string[] {
  const nameCounts = new Map<string, number>();
  for (const loaded of courses) {
    nameCounts.set(loaded.course.name, (nameCounts.get(loaded.course.name) ?? 0) + 1);
  }

  const used = new Set([previewLabel]);
  return courses.map((loaded) => {
    const duplicateName = (nameCounts.get(loaded.course.name) ?? 0) > 1
      || used.has(loaded.course.name);
    const base = duplicateName
      ? `${loaded.course.name} — ${sourceLabel(coursesDirectory, loaded.sourcePath)}`
      : loaded.course.name;
    let label = base;
    let suffix = 2;
    while (used.has(label)) {
      label = `${base} (${suffix})`;
      suffix += 1;
    }
    used.add(label);
    return label;
  });
}

function identityWarning(
  coursesDirectory: string,
  loser: LoadedCourseFile,
  conflictingSources: readonly string[],
  selectedSourcePath: string | undefined,
): CourseCatalogWarning {
  const loserSource = sourceLabel(coursesDirectory, loser.sourcePath);
  const message = selectedSourcePath === undefined
    ? `Course ID ${JSON.stringify(loser.course.id)} conflicts across sources (${conflictingSources
      .map((sourcePath) => sourceLabel(coursesDirectory, sourcePath))
      .join(", ")}); source ${loserSource} is not selectable.`
    : `Course ID ${JSON.stringify(loser.course.id)} from ${loserSource} conflicts with selected source ${sourceLabel(coursesDirectory, selectedSourcePath)}; source ${loserSource} is not selectable.`;
  return {
    code: "duplicate-course-id",
    sourcePath: loser.sourcePath,
    message,
  };
}

function compareWarnings(left: CourseCatalogWarning, right: CourseCatalogWarning): number {
  return compareText(left.sourcePath, right.sourcePath)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message);
}

/**
 * Reconciles every valid Course source at one pure boundary. The effective
 * selected external source wins its ID; otherwise ambiguous IDs have no winner.
 */
export function reconcileCourseCatalog(input: CourseCatalogInput): CourseCatalog {
  // A persisted locator that failed integrity validation is not merely a failed
  // selection: it is excluded from this reconciliation pass.  Otherwise an
  // ID-changed file could immediately reappear under its new identity.
  const rejectedSelectedSources = new Set(input.selectedSnapshot.warnings.flatMap((warning) =>
    "loadIssue" in warning && (warning.code === "selected-course-id-mismatch" || warning.code === "selected-course-unavailable")
      ? [warning.sourcePath]
      : []));
  const discoveredBySource = new Map<string, LoadedCourseFile>();
  for (const candidate of [...input.discovery.courses].sort(compareCandidates)) {
    if (!rejectedSelectedSources.has(candidate.sourcePath) && !discoveredBySource.has(candidate.sourcePath)) {
      discoveredBySource.set(candidate.sourcePath, candidate);
    }
  }

  const selectedUsesReservedIdentity = input.selectedSnapshot.sourcePath !== input.preview.sourcePath
    && input.selectedSnapshot.course.id === input.preview.courseId;
  const selectedExternal = input.selectedSnapshot.sourcePath === input.preview.sourcePath
    || selectedUsesReservedIdentity
    ? undefined
    : {
        course: input.selectedSnapshot.course,
        sourcePath: input.selectedSnapshot.sourcePath,
        warnings: input.selectedSnapshot.courseWarnings,
      } satisfies LoadedCourseFile;
  if (selectedExternal !== undefined) {
    // The fresh effective snapshot supersedes the discovery record for its exact source.
    discoveredBySource.set(selectedExternal.sourcePath, selectedExternal);
  }

  const reservedCandidates = [...discoveredBySource.values()]
    .filter((candidate) => candidate.course.id === input.preview.courseId)
    .sort(compareCandidates);
  const candidates = [...discoveredBySource.values()]
    .filter((candidate) => candidate.course.id !== input.preview.courseId)
    .sort(compareCandidates);
  const candidatesById = new Map<string, LoadedCourseFile[]>();
  for (const candidate of candidates) {
    const matches = candidatesById.get(candidate.course.id) ?? [];
    matches.push(candidate);
    candidatesById.set(candidate.course.id, matches);
  }

  const selectable: LoadedCourseFile[] = [];
  const identityWarnings: CourseCatalogWarning[] = [];
  for (const courseId of [...candidatesById.keys()].sort(compareText)) {
    const matches = candidatesById.get(courseId);
    if (matches === undefined) throw new Error("Missing Course identity group.");
    const selectedWins = selectedExternal?.course.id === courseId;
    if (selectedWins) {
      selectable.push(selectedExternal);
      for (const match of matches) {
        if (match.sourcePath !== selectedExternal.sourcePath) {
          identityWarnings.push(identityWarning(
            input.coursesDirectory,
            match,
            matches.map((candidate) => candidate.sourcePath),
            selectedExternal.sourcePath,
          ));
        }
      }
    } else if (matches.length === 1) {
      const only = matches[0];
      if (only === undefined) throw new Error("Missing unique Course candidate.");
      selectable.push(only);
    } else {
      const conflictingSources = matches.map((candidate) => candidate.sourcePath);
      for (const match of matches) {
        identityWarnings.push(identityWarning(
          input.coursesDirectory,
          match,
          conflictingSources,
          undefined,
        ));
      }
    }
  }
  selectable.sort(compareCandidates);

  const labels = createLabels(input.coursesDirectory, input.preview.label, selectable);
  const options: CourseCatalogOption[] = [{
    label: input.preview.label,
    courseId: input.preview.courseId,
    sourcePath: input.preview.sourcePath,
    loaded: "preview",
  }];
  selectable.forEach((loaded, index) => {
    const label = labels[index];
    if (label === undefined) throw new Error("Missing deterministic Course label.");
    options.push({
      label,
      courseId: loaded.course.id,
      sourcePath: loaded.sourcePath,
      loaded,
    });
  });

  const currentSourcePath = selectedExternal?.sourcePath ?? input.preview.sourcePath;
  const currentOptions = options.filter((option) => option.sourcePath === currentSourcePath);
  if (currentOptions.length !== 1) {
    throw new Error("Effective Course must map to exactly one catalog option.");
  }
  const current = currentOptions[0];
  if (current === undefined) throw new Error("Effective Course option is missing.");

  const warnings: CourseCatalogWarning[] = [
    ...reservedCandidates.map((candidate) => ({
      code: "reserved-course-id",
      sourcePath: candidate.sourcePath,
      message: `Course ID ${JSON.stringify(input.preview.courseId)} in ${candidate.sourcePath} is reserved by Preview Course; source ${sourceLabel(input.coursesDirectory, candidate.sourcePath)} is not selectable.`,
    })),
    ...(selectedUsesReservedIdentity ? [{
      code: "reserved-course-id",
      sourcePath: input.selectedSnapshot.sourcePath,
      message: `Selected external source ${input.selectedSnapshot.sourcePath} uses reserved Course ID ${JSON.stringify(input.preview.courseId)}; using Preview Course.`,
    }] : []),
    ...input.discovery.warnings.map((warning) => ({
      code: warning.code,
      sourcePath: warning.sourcePath,
      message: formatCourseLoadIssue(warning),
    })),
    ...input.selectedSnapshot.warnings.map((warning) => ({
      code: warning.code,
      sourcePath: "settingsPath" in warning ? warning.settingsPath : warning.sourcePath,
      message: selectionWarningText(warning),
    })),
    ...identityWarnings,
  ];
  warnings.sort(compareWarnings);

  return { options, currentValue: current.label, warnings };
}
