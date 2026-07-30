import { spawn } from "node:child_process";
import { link, mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  captureSelectedCourseSnapshot, discoverCourses, MAX_COURSE_JSON_BYTES,
  MAX_DISCOVERED_CANDIDATES, PREVIEW_COURSE_CATALOG, readCourseSettings,
  readStableCourseFile, reconcileCourseCatalog, selectCourseFromPath,
  writeCourseSettings,
} from "./index.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true }))); });
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), "golf-t04-retry-")); roots.push(value); return value; }
function valid(id: string, name = `Course ${id}`): string { return JSON.stringify({ schemaVersion: 1, id, name, holes: [{ id: "one", number: 1, par: 3, boundary: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }, tee: { x: 1, y: 1 }, cup: { x: 3, y: 3 }, regions: [{ terrain: "green", shape: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] } }] }] }); }

function runWriter(worker: string, cwd: string, id: string): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [worker, cwd, id], { stdio: "ignore" });
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`writer ${id} exited ${String(code)}`)));
  });
}

describe("V2-T04 retry acceptance coverage", () => {
  it("AC-CRS-006-01 accepts a depth-16 JSON, rejects depth-17 traversal, records unreadable descendants, and is deterministic", async () => {
    const cwd = await root(); const courses = join(cwd, ".pi/golf/courses"); let depth16 = courses;
    for (let depth = 1; depth <= 16; depth += 1) { depth16 = join(depth16, `d${depth}`); await mkdir(depth16, { recursive: true }); }
    await writeFile(join(depth16, "at-limit.JsOn"), valid("at-limit"));
    const depth17 = join(depth16, "d17"); await mkdir(depth17); await writeFile(join(depth17, "beyond.json"), valid("beyond"));
    const unreadable = join(courses, "unreadable.json"); await symlink(join(cwd, "missing.json"), unreadable);
    const first = await discoverCourses(courses); const second = await discoverCourses(courses);
    expect(first).toEqual(second); expect(first.courses.map((course) => course.course.id)).toEqual(["at-limit"]);
    expect(first.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unreadable-course" }), expect.objectContaining({ sourcePath: await realpath(depth17) })]));
  });

  it("AC-CRS-006-04 rejects an oversized discovery candidate before bounded reads and caps candidate diagnostics", async () => {
    const cwd = await root(); const courses = join(cwd, ".pi/golf/courses"); await mkdir(courses, { recursive: true });
    const oversized = join(courses, "000-oversized.json"); await writeFile(oversized, "{}"); await truncate(oversized, MAX_COURSE_JSON_BYTES + 1);
    for (let index = 0; index < MAX_DISCOVERED_CANDIDATES + 16; index += 1) await writeFile(join(courses, `candidate-${String(index).padStart(3, "0")}.json`), "{");
    const result = await discoverCourses(courses);
    expect(result.courses).toHaveLength(0); expect(result.warnings).toHaveLength(MAX_DISCOVERED_CANDIDATES);
    expect(result.warnings[0]).toMatchObject({ code: "too-large-course", sourcePath: await realpath(oversized) });
    expect(result.warnings.every((warning) => warning.diagnostics.length <= 256 && warning.warnings.length <= 256)).toBe(true);
  });

  it("AC-CRS-007-01 retries descriptor reads after file, symlink-target, and metadata replacement with matching bytes and identity", async () => {
    const cwd = await root(); const source = join(cwd, "source.json"); const replacement = join(cwd, "replacement.json"); await writeFile(source, valid("before")); await writeFile(replacement, valid("after"));
    const fileResult = await readStableCourseFile(source, { afterPreRead: async (_path, attempt) => { if (attempt === 0) await rename(replacement, source); } });
    expect(fileResult.ok).toBe(true); if (fileResult.ok) expect(JSON.parse(Buffer.from(fileResult.bytes).toString("utf8")).id).toBe("after");

    const first = join(cwd, "first.json"); const second = join(cwd, "second.json"); const alias = join(cwd, "alias.json"); await writeFile(first, valid("first")); await writeFile(second, valid("second")); await symlink(first, alias);
    const symlinkResult = await readStableCourseFile(alias, { afterPreRead: async (_path, attempt) => { if (attempt === 0) { await rm(alias); await symlink(second, alias); } } });
    expect(symlinkResult.ok).toBe(true); if (symlinkResult.ok) { expect(symlinkResult.sourcePath).toBe(await realpath(second)); expect(JSON.parse(Buffer.from(symlinkResult.bytes).toString("utf8")).id).toBe("second"); }

    const metadata = join(cwd, "metadata.json"); const metadataReplacement = join(cwd, "metadata-replacement.json"); await writeFile(metadata, valid("metadata")); await writeFile(metadataReplacement, valid("metadata")); let attempts = 0;
    const metadataResult = await readStableCourseFile(metadata, { afterPreRead: async (_path, attempt) => { attempts += 1; if (attempt === 0) await rename(metadataReplacement, metadata); } });
    expect(metadataResult.ok).toBe(true); expect(attempts).toBe(2);
  });

  it("AC-CRS-007-02 preserves the prior durable selection when a replacement stays unstable", async () => {
    const cwd = await root(); const selected = join(cwd, "selected.json"); await writeFile(selected, valid("selected")); await selectCourseFromPath(cwd, selected); const before = await readCourseSettings(cwd);
    const unstable = join(cwd, "unstable.json"); await writeFile(unstable, valid("unstable"));
    for (let index = 0; index < 2; index += 1) await writeFile(join(cwd, `unstable-${index}.json`), valid("unstable"));
    const result = await readStableCourseFile(unstable, { afterPreRead: async (_path, attempt) => { await rename(join(cwd, `unstable-${attempt}.json`), unstable); } });
    expect(result).toMatchObject({ ok: false, issue: { code: "unstable-course" } }); expect((await readCourseSettings(cwd)).settings).toEqual(before.settings);
  });

  it("AC-CRS-008-02 gives an explicit persisted winner precedence over a conflicting discovered source", async () => {
    const cwd = await root(); const courses = join(cwd, "courses"); await mkdir(courses); const discovered = join(courses, "discovered.json"); const selected = join(cwd, "selected.json");
    await writeFile(discovered, valid("conflict", "Discovered")); await writeFile(selected, valid("conflict", "Selected")); await selectCourseFromPath(cwd, selected);
    const catalog = reconcileCourseCatalog({ preview: PREVIEW_COURSE_CATALOG, coursesDirectory: courses, discovery: await discoverCourses(courses), selectedSnapshot: await captureSelectedCourseSnapshot(cwd) });
    expect(catalog.options.map((option) => option.sourcePath)).toEqual([PREVIEW_COURSE_CATALOG.sourcePath, await realpath(selected)]); expect(catalog.currentValue).toBe("Selected");
    expect(catalog.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "duplicate-course-id", sourcePath: await realpath(discovered) })]));
  });

  it("AC-CRS-009-01 retains strict bounded settings bytes after the post-rename durable interruption boundary", async () => {
    const cwd = await root(); const settings = { selectedCourseId: "durable", sourcePath: join(cwd, "durable.json") };
    await expect(writeCourseSettings(cwd, settings, { afterDurableCommit: () => { throw new Error("simulated interruption"); } })).rejects.toThrow("simulated interruption");
    const bytes = await readFile(join(cwd, ".pi/golf/settings.json")); expect(bytes.byteLength).toBeLessThanOrEqual(16 * 1024); expect(JSON.parse(bytes.toString("utf8"))).toEqual(settings); expect((await readCourseSettings(cwd)).settings).toEqual(settings);
  });

  it("AC-CRS-009-03 serializes independent Node runtime writers without collision or interleaved settings bytes", async () => {
    const cwd = await root(); const worker = join(cwd, "settings-writer.mjs"); const moduleUrl = new URL("./settings.ts", import.meta.url).href;
    await writeFile(worker, `import { writeCourseSettings } from ${JSON.stringify(moduleUrl)};\nconst [cwd, id] = process.argv.slice(2);\nawait writeCourseSettings(cwd, { selectedCourseId: id, sourcePath: cwd + "/" + id + ".json" });\n`);
    await Promise.all([runWriter(worker, cwd, "writer-one"), runWriter(worker, cwd, "writer-two")]);
    const bytes = await readFile(join(cwd, ".pi/golf/settings.json"), "utf8"); const settings = JSON.parse(bytes) as { selectedCourseId: string; sourcePath: string };
    expect(["writer-one", "writer-two"]).toContain(settings.selectedCourseId); expect(settings.sourcePath).toBe(join(cwd, `${settings.selectedCourseId}.json`)); expect((await readdir(join(cwd, ".pi/golf"))).filter((entry) => entry.endsWith(".tmp") || entry.endsWith(".lock"))).toEqual([]);
  });

  it("AC-CMD-003-02 keeps durable and visible selection unchanged for read, parse, validation, reserved identity, and settings failures", async () => {
    const cwd = await root(); const selected = join(cwd, "selected.json"); await writeFile(selected, valid("selected", "Selected")); await selectCourseFromPath(cwd, selected); const before = await readCourseSettings(cwd);
    const malformed = join(cwd, "malformed.json"); const invalid = join(cwd, "invalid.json"); const reserved = join(cwd, "reserved.json"); await writeFile(malformed, "{"); await writeFile(invalid, valid("UPPER")); await writeFile(reserved, valid("preview-course"));
    for (const path of [join(cwd, "missing.json"), malformed, invalid, reserved]) { expect((await selectCourseFromPath(cwd, path)).ok).toBe(false); expect((await readCourseSettings(cwd)).settings).toEqual(before.settings); }
    await expect(writeCourseSettings(cwd, { selectedCourseId: "", sourcePath: "relative" })).rejects.toThrow(); expect((await readCourseSettings(cwd)).settings).toEqual(before.settings);
  });

  it("AC-CRS-006-02 keeps hard-linked discovery sources distinct", async () => {
    const cwd = await root(); const courses = join(cwd, "courses"); await mkdir(courses); const source = join(courses, "source.json"); const hardLink = join(courses, "hard.json"); await writeFile(source, valid("source")); await link(source, hardLink);
    expect((await discoverCourses(courses)).courses.map((course) => course.sourcePath)).toEqual([await realpath(hardLink), await realpath(source)].sort());
  });
});
