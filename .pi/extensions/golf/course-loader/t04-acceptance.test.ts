import { link, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRoundCourseSnapshot } from "./snapshot.ts";
import {
  buildCourseSettingsModel, captureSelectedCourseSnapshot, discoverCourses,
  loadCourseFile, MAX_COURSE_JSON_BYTES, MAX_DISCOVERED_CANDIDATES,
  playSelectedMinimalCourseAndReturnToPreview, PREVIEW_COURSE_CATALOG, PREVIEW_COURSE_SETTINGS, readCourseSettings,
  reconcileCourseCatalog, selectCourseFromPath, selectLoadedCourse,
  writeCourseSettings,
} from "./index.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true }))); });
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), "golf-t04-")); roots.push(value); return value; }
function valid(id: string, name = `Course ${id}`): string { return JSON.stringify({ schemaVersion: 1, id, name, holes: [{ id: "one", number: 1, par: 3, boundary: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }, tee: { x: 1, y: 1 }, cup: { x: 3, y: 3 }, regions: [{ terrain: "green", shape: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] } }] }] }); }

async function loaded(path: string) {
  const result = await loadCourseFile(path);
  if (!result.ok) throw new Error(result.issue.message);
  return result.value;
}

describe("V2-T04 discovery and settings acceptance", () => {
  it("AC-CRS-006-01 AC-CRS-006-04 handles missing roots, case-insensitive JSON, deterministic order, limits, and bounded diagnostics", async () => {
    const cwd = await root(); const courses = join(cwd, ".pi/golf/courses");
    expect(await discoverCourses(courses)).toEqual({ courses: [], warnings: [] });
    await mkdir(courses, { recursive: true });
    await writeFile(join(courses, "z.JSON"), valid("z")); await writeFile(join(courses, "a.json"), valid("a"));
    for (let index = 0; index < MAX_DISCOVERED_CANDIDATES + 2; index += 1) await writeFile(join(courses, `x${String(index).padStart(3, "0")}.json`), valid(`x${index}`));
    const result = await discoverCourses(courses);
    expect(result.courses).toHaveLength(MAX_DISCOVERED_CANDIDATES);
    expect(result.courses.map((course) => course.sourcePath)).toEqual([...result.courses.map((course) => course.sourcePath)].sort());
    expect(result.warnings.length).toBeLessThanOrEqual(256);
  });

  it("AC-CRS-006-02 AC-CRS-006-03 canonicalizes aliases, keeps hard links distinct, rejects escaping discovery links, and permits explicit outside selection", async () => {
    const cwd = await root(); const courses = join(cwd, ".pi/golf/courses"); await mkdir(courses, { recursive: true });
    const source = join(courses, "source.json"); const hard = join(courses, "hard.json"); const outside = join(cwd, "outside.json");
    await writeFile(source, valid("inside")); await link(source, hard); await symlink(source, join(courses, "alias.json")); await writeFile(outside, valid("outside")); await symlink(outside, join(courses, "escape.json"));
    const discovery = await discoverCourses(courses);
    expect(discovery.courses.map((entry) => entry.sourcePath)).toEqual([await realpath(hard), await realpath(source)].sort());
    expect(discovery.warnings.map((warning) => warning.code)).toContain("outside-discovery-root");
    expect((await selectCourseFromPath(cwd, outside)).ok).toBe(true);
    expect((await readCourseSettings(cwd)).settings.sourcePath).toBe(await realpath(outside));
  });

  it("AC-CRS-007-01 AC-CRS-007-02 performs bounded descriptor reads and preserves selection on all invalid inputs", async () => {
    const cwd = await root(); const good = join(cwd, "good.json"); await writeFile(good, valid("good")); await selectCourseFromPath(cwd, good);
    const oversized = join(cwd, "large.json"); await writeFile(oversized, "{}"); await truncate(oversized, MAX_COURSE_JSON_BYTES + 1);
    const malformed = join(cwd, "malformed.json"); const duplicate = join(cwd, "duplicate.json"); const invalid = join(cwd, "invalid.json");
    await writeFile(malformed, "{"); await writeFile(duplicate, valid("duplicate").replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')); await writeFile(invalid, valid("UPPER"));
    for (const path of [oversized, malformed, duplicate, invalid, cwd]) expect((await selectCourseFromPath(cwd, path)).ok).toBe(false);
    expect((await readCourseSettings(cwd)).settings.selectedCourseId).toBe("good");
  });

  it("AC-CRS-007-03 reads a fresh stable source for each future Round snapshot", async () => {
    const cwd = await root(); const source = join(cwd, "fresh.json"); await writeFile(source, valid("fresh", "First")); await selectCourseFromPath(cwd, source);
    const first = await captureSelectedCourseSnapshot(cwd); await writeFile(source, valid("fresh", "Second")); const second = await captureSelectedCourseSnapshot(cwd);
    expect(first.course.name).toBe("First"); expect(second.course.name).toBe("Second");
  });

  it("AC-CRS-008-01 AC-CRS-008-04 excludes changed selected sources and reserved external identity at reconciliation and persistence boundaries", async () => {
    const cwd = await root(); const courses = join(cwd, ".pi/golf/courses"); await mkdir(courses, { recursive: true }); const changed = join(courses, "changed.json"); await writeFile(changed, valid("old")); await selectCourseFromPath(cwd, changed); await writeFile(changed, valid("new"));
    const snapshot = await captureSelectedCourseSnapshot(cwd); const catalog = reconcileCourseCatalog({ preview: PREVIEW_COURSE_CATALOG, coursesDirectory: courses, discovery: await discoverCourses(courses), selectedSnapshot: snapshot });
    expect(snapshot.usedPreviewFallback).toBe(true); expect(catalog.options.map((option) => option.courseId)).toEqual(["preview-course"]);
    await writeFile(changed, valid("preview-course"));
    const reserved = await loaded(changed); await expect(selectLoadedCourse(cwd, reserved)).rejects.toThrow("reserved by Preview Course");
  });

  it("AC-CRS-007-01 AC-CRS-007-02 AC-CRS-008-04 commits a fresh canonical record from a catalog/UI-time option and preserves prior selection on replacement failure", async () => {
    const cwd = await root(); const courses = join(cwd, ".pi/golf/courses"); await mkdir(courses, { recursive: true });
    const source = join(courses, "candidate.json"); await writeFile(source, valid("catalog-id", "Catalog Course"));
    const model = buildCourseSettingsModel(courses, await discoverCourses(courses), await captureSelectedCourseSnapshot(cwd));
    const catalogOption = model.options.find((option) => option.courseId === "catalog-id");
    if (catalogOption?.loaded === undefined || catalogOption.loaded === "preview") throw new Error("Missing catalog Course option.");

    await writeFile(source, valid("fresh-id", "Fresh Course"));
    await expect(selectLoadedCourse(cwd, catalogOption.loaded)).resolves.toEqual({ selectedCourseId: "fresh-id", sourcePath: await realpath(source) });
    expect((await readCourseSettings(cwd)).settings).toEqual({ selectedCourseId: "fresh-id", sourcePath: await realpath(source) });

    await writeFile(source, valid("preview-course", "Imposter Preview"));
    await expect(selectLoadedCourse(cwd, catalogOption.loaded)).rejects.toThrow("reserved by Preview Course");
    expect((await readCourseSettings(cwd)).settings).toEqual({ selectedCourseId: "fresh-id", sourcePath: await realpath(source) });
  });

  it("AC-CRS-008-02 AC-CRS-008-03 reconciles selected winners, duplicate exclusion, labels, replacement, and candidate permutations", async () => {
    const cwd = await root(); const courses = join(cwd, "courses"); await mkdir(courses); const a = join(courses, "a.json"); const b = join(courses, "b.json"); const c = join(courses, "c.json"); await writeFile(a, valid("same", "Same")); await writeFile(b, valid("same", "Same")); await writeFile(c, valid("other", "Same"));
    const [one, two, three] = await Promise.all([loaded(a), loaded(b), loaded(c)]); const selected = { course: two.course, sourcePath: two.sourcePath, usedPreviewFallback: false, warnings: [], courseWarnings: two.warnings } as const;
    const input = { preview: PREVIEW_COURSE_CATALOG, coursesDirectory: courses, selectedSnapshot: selected };
    const first = reconcileCourseCatalog({ ...input, discovery: { courses: [one, two, three], warnings: [] } }); const second = reconcileCourseCatalog({ ...input, discovery: { courses: [three, one, two], warnings: [] } });
    expect(first).toEqual(second); expect(first.options.map((option) => option.courseId)).toEqual(["preview-course", "same", "other"]); expect(first.options.map((option) => option.label)).toEqual(expect.arrayContaining([expect.stringContaining("b.json"), expect.stringContaining("c.json")])); expect(first.warnings).toHaveLength(1);
  });

  it("AC-CRS-009-01 AC-CRS-009-02 AC-CRS-009-03 writes strict bounded JSON atomically and serializes concurrent writers", async () => {
    const cwd = await root(); const first = { selectedCourseId: "one", sourcePath: join(cwd, "one.json") }; const second = { selectedCourseId: "two", sourcePath: join(cwd, "two.json") };
    await Promise.all([writeCourseSettings(cwd, first), writeCourseSettings(cwd, second)]);
    const paths = join(cwd, ".pi/golf"); const settingsPath = join(paths, "settings.json"); const bytes = await readFile(settingsPath); expect(bytes.byteLength).toBeLessThanOrEqual(16 * 1024); expect(JSON.parse(bytes.toString("utf8"))).toEqual((await readCourseSettings(cwd)).settings);
    await expect(writeCourseSettings(cwd, first, { beforeRename: () => { throw new Error("injected interruption"); } })).rejects.toThrow("injected interruption");
    expect(await readFile(settingsPath)).toEqual(bytes); expect((await readdir(paths)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    await expect(writeCourseSettings(cwd, { selectedCourseId: "", sourcePath: "not-a-path" })).rejects.toThrow();
  });

  it("AC-CRS-009-04 AC-CMD-002-02 selection changes future settings without mutating an active Round snapshot", async () => {
    const cwd = await root(); const source = join(cwd, "active.json"); await writeFile(source, valid("active", "Active")); const active = await createRoundCourseSnapshot(async () => valid("round", "Round")); await selectCourseFromPath(cwd, source);
    expect(active.course.id).toBe("round"); expect((await readCourseSettings(cwd)).settings.selectedCourseId).toBe("active");
  });

  it("AC-CRS-010-01 AC-CRS-010-02 AC-CMD-002-01 creates exactly one reconciled Course model with warnings outside values", async () => {
    const cwd = await root(); const outside = join(cwd, "outside.json"); await writeFile(outside, valid("outside", "Outside")); await selectCourseFromPath(cwd, outside); const selected = await captureSelectedCourseSnapshot(cwd);
    const model = buildCourseSettingsModel(join(cwd, "empty"), { courses: [], warnings: [{ code: "invalid-course", sourcePath: "/bad", message: "bad", diagnostics: [], warnings: [] }] }, selected);
    expect(model.title).toBe("Golf Settings"); expect(model.items).toEqual([{ id: "course", label: "Course", currentValue: "Outside", values: ["Preview Course", "Outside"] }]); expect(model.warningLines).toEqual(["bad"]);
  });

  it("AC-CRS-010-03 documents coordinates, Length, shapes, closed containment, layering, cell ownership, limits, duplicate keys, and validation", async () => {
    const documentation = await readFile(new URL("../../../../docs/course-format.md", import.meta.url), "utf8");
    for (const term of ["Coordinates", "Length", "Polygon", "Ellipse", "Corridor", "Containment is closed", "array order", "owns cell", "Resource limits", "duplicate object members", "validation"]) expect(documentation).toContain(term);
  });

  it("AC-CRS-010-04 selects, parses, snapshots, rasterizes, simulates, and returns the unchanged minimal example to Preview", async () => {
    const cwd = await root(); const minimal = new URL("../../../../docs/examples/minimal-course.json", import.meta.url);
    expect((await selectCourseFromPath(cwd, minimal.pathname)).ok).toBe(true);
    const result = await playSelectedMinimalCourseAndReturnToPreview(cwd);
    expect(result).toMatchObject({ courseName: "Minimal Course", rasterCellCount: 200, shot: { terminal: "rest", resultingRound: { playedStrokes: 1, penaltyStrokes: 0 } } });
    expect((await readCourseSettings(cwd)).settings).toEqual(PREVIEW_COURSE_SETTINGS);
  });

  it("AC-CMD-003-03 plays the explicitly selected unchanged minimal example and safely returns to Preview", async () => {
    const cwd = await root(); const minimal = new URL("../../../../docs/examples/minimal-course.json", import.meta.url);
    expect((await selectCourseFromPath(cwd, minimal.pathname)).ok).toBe(true);
    await expect(playSelectedMinimalCourseAndReturnToPreview(cwd)).resolves.toMatchObject({ courseName: "Minimal Course" });
    expect((await readCourseSettings(cwd)).settings).toEqual(PREVIEW_COURSE_SETTINGS);
    await expect(playSelectedMinimalCourseAndReturnToPreview(cwd)).rejects.toThrow("Select docs/examples/minimal-course.json");
    expect((await readCourseSettings(cwd)).settings).toEqual(PREVIEW_COURSE_SETTINGS);
  });

  it("AC-CMD-003-01 AC-CMD-003-02 preserves explicit selection on malformed replacement", async () => {
    const cwd = await root(); const minimal = new URL("../../../../docs/examples/minimal-course.json", import.meta.url); const artifact = join(cwd, "minimal.json"); await writeFile(artifact, await readFile(minimal)); expect((await selectCourseFromPath(cwd, artifact)).ok).toBe(true); const before = await readCourseSettings(cwd); await writeFile(artifact, "{"); expect((await selectCourseFromPath(cwd, artifact)).ok).toBe(false); expect((await readCourseSettings(cwd)).settings).toEqual(before.settings);
  });
});
