import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildCourseSettingsModel,
  captureSelectedCourseSnapshot,
  discoverCourses,
  getCourseProjectPaths,
  PREVIEW_COURSE_SETTINGS,
  PREVIEW_COURSE_SOURCE,
  readCourseSettings,
  selectCourseFromPath,
  writeCourseSettings,
} from "./index.ts";

interface MutableCourse {
  schemaVersion: number;
  id: string;
  name: string;
  holes: Array<{
    id: string;
    number: number;
    par: number;
    boundary: { type: string; points: Array<{ x: number; y: number }> };
    tee: { x: number; y: number };
    cup: { x: number; y: number };
    regions: Array<{
      terrain: string;
      shape: {
        type: string;
        center: { x: number; y: number };
        radiusX: number;
        radiusY: number;
      };
    }>;
  }>;
}

function makeCourse(id: string, name: string): MutableCourse {
  return {
    schemaVersion: 1,
    id,
    name,
    holes: [{
      id: "hole-1",
      number: 1,
      par: 3,
      boundary: {
        type: "polygon",
        points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }],
      },
      tee: { x: 1, y: 1 },
      cup: { x: 7, y: 7 },
      regions: [{
        terrain: "green",
        shape: {
          type: "ellipse",
          center: { x: 7, y: 7 },
          radiusX: 1,
          radiusY: 1,
        },
      }],
    }],
  };
}

const roots: string[] = [];

async function temporaryProject(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `pi-golf-${label}-`));
  roots.push(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })));
});

describe("custom Course discovery", () => {
  it("treats a missing directory as empty and uses Pi's project config directory", async () => {
    const cwd = await temporaryProject("missing");
    const paths = getCourseProjectPaths(cwd);
    expect(paths.coursesDirectory).toBe(join(cwd, CONFIG_DIR_NAME, "golf", "courses"));
    expect(await discoverCourses(paths.coursesDirectory)).toEqual({ courses: [], warnings: [] });
  });

  it("discovers recursively in deterministic relative-path order", async () => {
    const cwd = await temporaryProject("order");
    const { coursesDirectory } = getCourseProjectPaths(cwd);
    await writeJson(join(coursesDirectory, "z.json"), makeCourse("z-course", "Zulu"));
    await writeJson(join(coursesDirectory, "nested", "b.json"), makeCourse("b-course", "Bravo"));
    await writeJson(join(coursesDirectory, "a.json"), makeCourse("a-course", "Alpha"));
    await writeFile(join(coursesDirectory, "ignored.txt"), "not JSON", "utf8");

    const first = await discoverCourses(coursesDirectory);
    const second = await discoverCourses(coursesDirectory);
    expect(first).toEqual(second);
    expect(first.courses.map((loaded) => loaded.course.id)).toEqual([
      "a-course", "b-course", "z-course",
    ]);
    expect(first.warnings).toEqual([]);
  });

  it("keeps malformed, unreadable, and multi-error invalid files as warnings only", async () => {
    const cwd = await temporaryProject("invalid");
    const { coursesDirectory } = getCourseProjectPaths(cwd);
    await mkdir(coursesDirectory, { recursive: true });
    await writeFile(join(coursesDirectory, "malformed.json"), "{ nope", "utf8");
    await symlink(join(coursesDirectory, "missing-target.json"), join(coursesDirectory, "unreadable.json"));
    await writeJson(join(coursesDirectory, "invalid.json"), {
      schemaVersion: 9,
      id: "",
      name: " ",
      holes: [],
    });
    await writeJson(join(coursesDirectory, "valid.json"), makeCourse("valid-course", "Valid"));

    const result = await discoverCourses(coursesDirectory);
    expect(result.courses.map((loaded) => loaded.course.id)).toEqual(["valid-course"]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "invalid-course", "malformed-json", "unreadable-course",
    ]);
    const invalid = result.warnings.find((warning) => warning.code === "invalid-course");
    expect(invalid?.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(expect.arrayContaining([
      "$.schemaVersion", "$.id", "$.name", "$.holes",
    ]));
  });

  it("rejects every ambiguous duplicate ID, including the built-in ID", async () => {
    const cwd = await temporaryProject("duplicates");
    const { coursesDirectory } = getCourseProjectPaths(cwd);
    await writeJson(join(coursesDirectory, "a.json"), makeCourse("same-id", "First"));
    await writeJson(join(coursesDirectory, "b.json"), makeCourse("same-id", "Second"));
    await writeJson(join(coursesDirectory, "preview.json"), makeCourse("preview-course", "Impostor"));
    await writeJson(join(coursesDirectory, "unique.json"), makeCourse("unique-id", "Unique"));

    const result = await discoverCourses(coursesDirectory);
    expect(result.courses.map((loaded) => loaded.course.id)).toEqual(["unique-id"]);
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "reserved-course-id", "duplicate-course-id", "duplicate-course-id",
    ]);
    expect(result.warnings.map((warning) => warning.message).join("\n")).toContain("a.json, b.json");
    expect(result.warnings.map((warning) => warning.message).join("\n")).toContain("reserved by built-in content");
  });
});

describe("project Course settings and explicit selection", () => {
  it("validates malformed and schema-invalid settings as unknown input", async () => {
    const cwd = await temporaryProject("settings-invalid");
    const { settingsPath } = getCourseProjectPaths(cwd);
    await writeFile(settingsPath, "{", { encoding: "utf8", flag: "w" }).catch(async () => {
      await mkdir(dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, "{", "utf8");
    });
    const malformed = await readCourseSettings(cwd);
    expect(malformed.settings).toEqual(PREVIEW_COURSE_SETTINGS);
    expect(malformed.warning?.code).toBe("malformed-settings");

    await writeJson(settingsPath, { selectedCourseId: 42, sourcePath: "x", extra: true });
    const invalid = await readCourseSettings(cwd);
    expect(invalid.settings).toEqual(PREVIEW_COURSE_SETTINGS);
    expect(invalid.warning?.code).toBe("invalid-settings");
  });

  it("creates directories and serializes complete atomic settings writes", async () => {
    const cwd = await temporaryProject("settings-write");
    const first = { selectedCourseId: "first", sourcePath: "/first.json" };
    const second = { selectedCourseId: "second", sourcePath: "/second.json" };
    await Promise.all([
      writeCourseSettings(cwd, first),
      writeCourseSettings(cwd, second),
    ]);
    expect((await readCourseSettings(cwd)).settings).toEqual(second);
    const directoryEntries = await import("node:fs/promises").then(async ({ readdir }) =>
      readdir(dirname(getCourseProjectPaths(cwd).settingsPath)));
    expect(directoryEntries).toEqual(["settings.json"]);
  });

  it("leaves prior settings byte-for-byte unchanged for malformed and invalid selections", async () => {
    const cwd = await temporaryProject("nonmutation");
    const { settingsPath } = getCourseProjectPaths(cwd);
    await writeCourseSettings(cwd, { selectedCourseId: "prior", sourcePath: "/prior.json" });
    const before = await readFile(settingsPath);

    const malformedPath = join(cwd, "bad course.json");
    await writeFile(malformedPath, "not-json", "utf8");
    const malformed = await selectCourseFromPath(cwd, "bad course.json");
    expect(malformed.ok).toBe(false);
    expect(malformed.ok ? undefined : malformed.issue.code).toBe("malformed-json");
    expect(await readFile(settingsPath)).toEqual(before);

    const invalid = makeCourse("invalid", "Invalid");
    const invalidHole = invalid.holes[0];
    if (invalidHole === undefined) throw new Error("Missing invalid Course fixture Hole.");
    invalidHole.par = 9;
    invalidHole.cup = { x: 20, y: 20 };
    await writeJson(join(cwd, "invalid.json"), invalid);
    const invalidResult = await selectCourseFromPath(cwd, "invalid.json");
    expect(invalidResult.ok).toBe(false);
    if (invalidResult.ok) throw new Error("Expected invalid selection.");
    expect(invalidResult.issue.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(expect.arrayContaining([
      "$.holes[0].par", "$.holes[0].cup",
    ]));
    expect(await readFile(settingsPath)).toEqual(before);
  });

  it("rejects an explicit external Course using a reserved built-in ID without changing settings", async () => {
    const cwd = await temporaryProject("reserved-explicit");
    const { settingsPath } = getCourseProjectPaths(cwd);
    await writeCourseSettings(cwd, { selectedCourseId: "prior", sourcePath: "/prior.json" });
    const before = await readFile(settingsPath);
    const sourcePath = join(cwd, "preview impostor.json");
    await writeJson(sourcePath, makeCourse("preview-course", "Preview Impostor"));

    const result = await selectCourseFromPath(cwd, sourcePath);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected reserved Course selection to fail.");
    expect(result.issue.code).toBe("reserved-course-id");
    expect(result.issue.message).toContain("choose a different Course ID");
    expect(await readFile(settingsPath)).toEqual(before);
  });

  it("resolves a valid path with spaces outside discovery and persists ID plus absolute source", async () => {
    const cwd = await temporaryProject("outside");
    const sourcePath = join(cwd, "outside courses", "my course.json");
    await writeJson(sourcePath, makeCourse("outside-course", "Outside"));

    const result = await selectCourseFromPath(cwd, join("outside courses", "my course.json"));
    expect(result.ok).toBe(true);
    expect((await readCourseSettings(cwd)).settings).toEqual({
      selectedCourseId: "outside-course",
      sourcePath,
    });
  });
});

describe("future-Round Course snapshot boundary", () => {
  it("falls back with warnings for malformed settings, missing sources, and ID changes", async () => {
    const cwd = await temporaryProject("fallback");
    const { settingsPath } = getCourseProjectPaths(cwd);
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, "{", "utf8");
    const malformed = await captureSelectedCourseSnapshot(cwd);
    expect(malformed.course.id).toBe("preview-course");
    expect(malformed.usedPreviewFallback).toBe(true);
    expect(malformed.warnings[0]?.code).toBe("malformed-settings");

    const missingPath = join(cwd, "missing.json");
    await writeCourseSettings(cwd, { selectedCourseId: "missing", sourcePath: missingPath });
    const missing = await captureSelectedCourseSnapshot(cwd);
    expect(missing.course.id).toBe("preview-course");
    expect(missing.warnings[0]?.code).toBe("selected-course-unavailable");

    await writeJson(missingPath, makeCourse("different", "Different"));
    const mismatch = await captureSelectedCourseSnapshot(cwd);
    expect(mismatch.course.id).toBe("preview-course");
    expect(mismatch.warnings[0]?.code).toBe("selected-course-id-mismatch");
  });

  it("does not mutate a captured active snapshot when selection or source files change or disappear", async () => {
    const cwd = await temporaryProject("snapshot");
    const sourcePath = join(cwd, "selected.json");
    await writeJson(sourcePath, makeCourse("selected", "Original Name"));
    expect((await selectCourseFromPath(cwd, sourcePath)).ok).toBe(true);

    const activeSnapshot = await captureSelectedCourseSnapshot(cwd);
    const capturedBytes = JSON.stringify(activeSnapshot.course);
    expect(Object.isFrozen(activeSnapshot.course)).toBe(true);
    expect(Object.isFrozen(activeSnapshot.course.holes)).toBe(true);

    await writeCourseSettings(cwd, PREVIEW_COURSE_SETTINGS);
    await writeJson(sourcePath, makeCourse("selected", "Edited Name"));
    await writeCourseSettings(cwd, { selectedCourseId: "selected", sourcePath });
    const editedNextRound = await captureSelectedCourseSnapshot(cwd);
    expect(editedNextRound.course.name).toBe("Edited Name");
    expect(JSON.stringify(activeSnapshot.course)).toBe(capturedBytes);
    expect(activeSnapshot.course.name).toBe("Original Name");

    await rm(sourcePath);
    expect(JSON.stringify(activeSnapshot.course)).toBe(capturedBytes);
    await writeCourseSettings(cwd, { selectedCourseId: "selected", sourcePath });
    const nextRound = await captureSelectedCourseSnapshot(cwd);
    expect(nextRound.course.id).toBe("preview-course");
    expect(nextRound.sourcePath).toBe(PREVIEW_COURSE_SOURCE);
  });
});

describe("Golf settings UI model", () => {
  it("contains exactly one Course setting and keeps warnings out of deterministic values", async () => {
    const cwd = await temporaryProject("ui-model");
    const { coursesDirectory } = getCourseProjectPaths(cwd);
    await writeJson(join(coursesDirectory, "b.json"), makeCourse("b", "Same"));
    await writeJson(join(coursesDirectory, "a.json"), makeCourse("a", "Same"));
    await writeFile(join(coursesDirectory, "broken.json"), "{", "utf8");
    const discovery = await discoverCourses(coursesDirectory);
    const model = buildCourseSettingsModel(coursesDirectory, discovery, PREVIEW_COURSE_SOURCE, []);

    expect(model.title).toBe("Golf Settings");
    expect(model.items).toHaveLength(1);
    expect(model.items[0]).toMatchObject({ id: "course", label: "Course", currentValue: "Preview Course" });
    expect(model.items[0]?.values).toEqual([
      "Preview Course", "Same — a.json", "Same — b.json",
    ]);
    expect(model.warningLines).toHaveLength(1);
    expect(model.items[0]?.values?.join("\n")).not.toContain("Malformed");
  });
});
