import { describe, expect, it } from "vitest";

import {
  PREVIEW_COURSE_CATALOG,
  PREVIEW_COURSE_SOURCE,
  reconcileCourseCatalog,
  type CourseCatalog,
  type CourseDiscoveryResult,
  type LoadedCourseFile,
  type SelectedCourseSnapshot,
} from "./index.ts";

const COURSES_DIRECTORY = "/project/.pi/golf/courses";

function candidate(
  sourcePath: string,
  id: string,
  name = id,
): LoadedCourseFile {
  return {
    sourcePath,
    warnings: [],
    course: { schemaVersion: 1, id, name, holes: [] },
  };
}

function previewSnapshot(): SelectedCourseSnapshot {
  return {
    course: { schemaVersion: 1, id: "preview-course", name: "Preview Course", holes: [] },
    sourcePath: PREVIEW_COURSE_SOURCE,
    usedPreviewFallback: false,
    warnings: [],
    courseWarnings: [],
  };
}

function selectedSnapshot(loaded: LoadedCourseFile): SelectedCourseSnapshot {
  return {
    course: loaded.course,
    sourcePath: loaded.sourcePath,
    usedPreviewFallback: false,
    warnings: [],
    courseWarnings: loaded.warnings,
  };
}

function reconcile(
  courses: readonly LoadedCourseFile[],
  selected: SelectedCourseSnapshot = previewSnapshot(),
  warnings: CourseDiscoveryResult["warnings"] = [],
): CourseCatalog {
  return reconcileCourseCatalog({
    preview: PREVIEW_COURSE_CATALOG,
    coursesDirectory: COURSES_DIRECTORY,
    discovery: { courses, warnings },
    selectedSnapshot: selected,
  });
}

function assertGlobalInvariants(catalog: CourseCatalog): void {
  expect(catalog.options[0]).toMatchObject({
    courseId: "preview-course",
    sourcePath: PREVIEW_COURSE_SOURCE,
  });
  expect(new Set(catalog.options.map((option) => option.courseId)).size)
    .toBe(catalog.options.length);
  expect(new Set(catalog.options.map((option) => option.sourcePath)).size)
    .toBe(catalog.options.length);
  expect(catalog.options.filter((option) => option.label === catalog.currentValue))
    .toHaveLength(1);
  const values = catalog.options.map((option) => option.label);
  for (const warning of catalog.warnings) expect(values).not.toContain(warning.message);
}

describe("Course catalog reconciliation", () => {
  it("keeps Preview first and rejects an external Preview identity", () => {
    const reserved = candidate(`${COURSES_DIRECTORY}/impostor.json`, "preview-course", "Impostor");
    const catalog = reconcile([reserved]);

    expect(catalog.options).toHaveLength(1);
    expect(catalog.currentValue).toBe("Preview Course");
    expect(catalog.warnings).toEqual([expect.objectContaining({
      code: "reserved-course-id",
      sourcePath: reserved.sourcePath,
    })]);
    assertGlobalInvariants(catalog);
  });

  it("retains unique discovered IDs and collapses exact source duplicates", () => {
    const alpha = candidate(`${COURSES_DIRECTORY}/alpha.json`, "alpha", "Alpha");
    const beta = candidate(`${COURSES_DIRECTORY}/beta.json`, "beta", "Beta");
    const catalog = reconcile([beta, alpha, { ...alpha }]);

    expect(catalog.options.map((option) => option.courseId)).toEqual([
      "preview-course", "alpha", "beta",
    ]);
    expect(catalog.warnings).toEqual([]);
    assertGlobalInvariants(catalog);
  });

  it("excludes every duplicate discovered ID when there is no selected winner", () => {
    const first = candidate(`${COURSES_DIRECTORY}/a.json`, "shared", "First");
    const second = candidate(`${COURSES_DIRECTORY}/b.json`, "shared", "Second");
    const third = candidate(`${COURSES_DIRECTORY}/c.json`, "shared", "Third");
    const catalog = reconcile([third, first, second]);

    expect(catalog.options.map((option) => option.courseId)).toEqual(["preview-course"]);
    expect(catalog.warnings.map((warning) => warning.sourcePath)).toEqual([
      first.sourcePath, second.sourcePath, third.sourcePath,
    ]);
    for (const warning of catalog.warnings) {
      expect(warning.message).toContain("a.json, b.json, c.json");
      expect(warning.message).toContain("is not selectable");
    }
    assertGlobalInvariants(catalog);
  });

  it("adds a unique selected source outside discovery as the exact current option", () => {
    const discovered = candidate(`${COURSES_DIRECTORY}/alpha.json`, "alpha", "Alpha");
    const outside = candidate("/outside/selected.json", "outside", "Outside");
    const catalog = reconcile([discovered], selectedSnapshot(outside));

    expect(catalog.options.map((option) => option.sourcePath)).toEqual([
      PREVIEW_COURSE_SOURCE, outside.sourcePath, discovered.sourcePath,
    ]);
    expect(catalog.options.find((option) => option.label === catalog.currentValue)?.sourcePath)
      .toBe(outside.sourcePath);
    assertGlobalInvariants(catalog);
  });

  it("disambiguates equal display names only when their IDs are distinct", () => {
    const discovered = candidate(`${COURSES_DIRECTORY}/same.json`, "discovered-id", "Same Name");
    const outside = candidate("/outside/same.json", "outside-id", "Same Name");
    const catalog = reconcile([discovered], selectedSnapshot(outside));
    const customLabels = catalog.options.slice(1).map((option) => option.label);

    expect(customLabels).toHaveLength(2);
    expect(customLabels.every((label) => label.startsWith("Same Name — "))).toBe(true);
    expect(new Set(customLabels).size).toBe(2);
    expect(catalog.warnings).toEqual([]);
    assertGlobalInvariants(catalog);
  });

  it("makes a selected outside source the sole winner over every discovered same-ID source", () => {
    const first = candidate(`${COURSES_DIRECTORY}/a.json`, "shared", "First");
    const second = candidate(`${COURSES_DIRECTORY}/b.json`, "shared", "Second");
    const outside = candidate("/outside/selected.json", "shared", "Selected");
    const catalog = reconcile([second, first], selectedSnapshot(outside));

    expect(catalog.options.filter((option) => option.courseId === "shared"))
      .toEqual([expect.objectContaining({ sourcePath: outside.sourcePath })]);
    expect(catalog.currentValue).toBe("Selected");
    expect(catalog.warnings.map((warning) => warning.sourcePath)).toEqual([
      first.sourcePath, second.sourcePath,
    ]);
    expect(catalog.warnings.every((warning) => warning.message.includes(outside.sourcePath)))
      .toBe(true);
    assertGlobalInvariants(catalog);
  });

  it("keeps a selected discovered member as sole winner without warning against itself", () => {
    const first = candidate(`${COURSES_DIRECTORY}/a.json`, "shared", "First");
    const selected = candidate(`${COURSES_DIRECTORY}/b.json`, "shared", "Selected");
    const catalog = reconcile([selected, first], selectedSnapshot(selected));

    expect(catalog.options.filter((option) => option.courseId === "shared"))
      .toEqual([expect.objectContaining({ sourcePath: selected.sourcePath })]);
    expect(catalog.warnings.map((warning) => warning.sourcePath)).toEqual([first.sourcePath]);
    expect(catalog.warnings.some((warning) => warning.sourcePath === selected.sourcePath))
      .toBe(false);
    assertGlobalInvariants(catalog);
  });

  it("represents a uniquely discovered selected source exactly once", () => {
    const selected = candidate(`${COURSES_DIRECTORY}/selected.json`, "selected", "Selected");
    const catalog = reconcile([selected, { ...selected }], selectedSnapshot(selected));

    expect(catalog.options.filter((option) => option.sourcePath === selected.sourcePath))
      .toHaveLength(1);
    expect(catalog.currentValue).toBe("Selected");
    expect(catalog.warnings).toEqual([]);
    assertGlobalInvariants(catalog);
  });

  it("keeps a valid selection stable as conflicts appear, disappear, or are explicitly selected", () => {
    const selected = candidate("/outside/selected.json", "shared", "Selected");
    const conflict = candidate(`${COURSES_DIRECTORY}/conflict.json`, "shared", "Conflict");

    const absent = reconcile([], selectedSnapshot(selected));
    const present = reconcile([conflict], selectedSnapshot(selected));
    const removed = reconcile([], selectedSnapshot(selected));
    expect([absent, present, removed].map((catalog) => catalog.currentValue))
      .toEqual(["Selected", "Selected", "Selected"]);
    expect(present.options.some((option) => option.sourcePath === conflict.sourcePath)).toBe(false);
    expect(present.warnings.map((warning) => warning.sourcePath)).toEqual([conflict.sourcePath]);

    const explicitlySwitched = reconcile([conflict], selectedSnapshot(conflict));
    expect(explicitlySwitched.options.find((option) => option.label === explicitlySwitched.currentValue)?.sourcePath)
      .toBe(conflict.sourcePath);
    expect(explicitlySwitched.options.some((option) => option.sourcePath === selected.sourcePath))
      .toBe(false);
    for (const catalog of [absent, present, removed, explicitlySwitched]) {
      assertGlobalInvariants(catalog);
    }
  });

  it("produces byte-equivalent order and warnings for candidate and issue permutations", () => {
    const duplicateA = candidate(`${COURSES_DIRECTORY}/a.json`, "duplicate", "Duplicate A");
    const duplicateB = candidate(`${COURSES_DIRECTORY}/b.json`, "duplicate", "Duplicate B");
    const unique = candidate(`${COURSES_DIRECTORY}/unique.json`, "unique", "Unique");
    const issues: CourseDiscoveryResult["warnings"] = [{
      code: "malformed-json",
      sourcePath: `${COURSES_DIRECTORY}/z-broken.json`,
      message: `Malformed JSON in Course file: ${COURSES_DIRECTORY}/z-broken.json`,
      diagnostics: [],
      warnings: [],
    }, {
      code: "unreadable-course",
      sourcePath: `${COURSES_DIRECTORY}/c-missing.json`,
      message: `Cannot read Course file: ${COURSES_DIRECTORY}/c-missing.json`,
      diagnostics: [],
      warnings: [],
    }];

    const first = reconcile([duplicateB, unique, duplicateA], previewSnapshot(), issues);
    const second = reconcile(
      [duplicateA, duplicateB, unique].reverse(),
      previewSnapshot(),
      [...issues].reverse(),
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    assertGlobalInvariants(first);
  });
});
