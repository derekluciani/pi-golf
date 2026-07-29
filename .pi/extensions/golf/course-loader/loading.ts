import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

import { MAX_COURSE_JSON_BYTES } from "./schema.ts";
import { parseCourseJson } from "./raw-parser.ts";
import type { Course, CourseDiagnostic, CourseWarning } from "./types.ts";

export const MAX_DISCOVERY_DEPTH = 16;
export const MAX_DISCOVERED_CANDIDATES = 256;
export const MAX_DISCOVERY_DIAGNOSTICS = 256;
export const MAX_STABLE_READ_RETRIES = 2;

export type CourseLoadIssueCode = "course-warning" | "invalid-course" | "reserved-course-id" | "unreadable-course" | "unreadable-directory" | "outside-discovery-root" | "unstable-course" | "not-regular-course" | "too-large-course";
export interface CourseLoadIssue { readonly code: CourseLoadIssueCode; readonly sourcePath: string; readonly message: string; readonly diagnostics: readonly CourseDiagnostic[]; readonly warnings: readonly CourseWarning[]; }
export interface LoadedCourseFile { readonly course: Course; readonly sourcePath: string; readonly warnings: readonly CourseWarning[]; }
export type CourseFileLoadResult = { readonly ok: true; readonly value: LoadedCourseFile } | { readonly ok: false; readonly issue: CourseLoadIssue };
export interface CourseDiscoveryResult { readonly courses: readonly LoadedCourseFile[]; readonly warnings: readonly CourseLoadIssue[]; }

function issue(code: CourseLoadIssueCode, sourcePath: string, message: string, diagnostics: readonly CourseDiagnostic[] = [], warnings: readonly CourseWarning[] = []): CourseLoadIssue { return { code, sourcePath, message, diagnostics, warnings }; }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function sameMetadata(left: Awaited<ReturnType<typeof stat>>, right: Awaited<ReturnType<typeof stat>>): boolean { return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.mode === right.mode; }

/** Bounded regular-file read linearized by metadata before and after its bytes. */
export async function readStableCourseFile(path: string): Promise<{ readonly ok: true; readonly sourcePath: string; readonly bytes: Uint8Array } | { readonly ok: false; readonly issue: CourseLoadIssue }> {
  let sourcePath: string;
  try { sourcePath = await realpath(path); } catch { return { ok: false, issue: issue("unreadable-course", resolve(path), `Cannot canonicalize Course file: ${resolve(path)}`) }; }
  for (let attempt = 0; attempt < MAX_STABLE_READ_RETRIES; attempt += 1) {
    let before: Awaited<ReturnType<typeof stat>>;
    try { before = await stat(sourcePath); } catch { return { ok: false, issue: issue("unreadable-course", sourcePath, `Cannot read Course file: ${sourcePath}`) }; }
    if (!before.isFile()) return { ok: false, issue: issue("not-regular-course", sourcePath, `Course source is not a regular file: ${sourcePath}`) };
    if (before.size > MAX_COURSE_JSON_BYTES) return { ok: false, issue: issue("too-large-course", sourcePath, `Course JSON exceeds ${MAX_COURSE_JSON_BYTES} bytes: ${sourcePath}`) };
    let bytes: Uint8Array;
    try { bytes = await readFile(sourcePath); } catch { return { ok: false, issue: issue("unreadable-course", sourcePath, `Cannot read Course file: ${sourcePath}`) }; }
    let after: Awaited<ReturnType<typeof stat>>;
    try { after = await stat(sourcePath); } catch { continue; }
    if (bytes.byteLength <= MAX_COURSE_JSON_BYTES && sameMetadata(before, after)) return { ok: true, sourcePath, bytes };
  }
  return { ok: false, issue: issue("unstable-course", sourcePath, `Course file changed while being read: ${sourcePath}`) };
}

export async function loadCourseFile(path: string): Promise<CourseFileLoadResult> {
  const stable = await readStableCourseFile(path);
  if (!stable.ok) return stable;
  const validation = parseCourseJson(stable.bytes);
  if (!validation.ok) return { ok: false, issue: issue("invalid-course", stable.sourcePath, `Invalid Course file: ${stable.sourcePath}`, validation.errors, validation.warnings) };
  return { ok: true, value: { course: validation.value, sourcePath: stable.sourcePath, warnings: validation.warnings } };
}
export async function loadSelectableCourseFile(path: string): Promise<CourseFileLoadResult> {
  const loaded = await loadCourseFile(path);
  if (!loaded.ok || loaded.value.course.id !== "preview-course") return loaded;
  return { ok: false, issue: issue("reserved-course-id", loaded.value.sourcePath, `Course ID "preview-course" in ${loaded.value.sourcePath} is reserved by Preview Course.`) };
}
function within(root: string, value: string): boolean { const path = relative(root, value); return path === "" || (!path.startsWith(`..${sep}`) && path !== ".."); }

/** Deterministic bounded discovery. Files are only read after all path policy checks. */
export async function discoverCourses(directory: string): Promise<CourseDiscoveryResult> {
  const warnings: CourseLoadIssue[] = []; const candidates: string[] = []; const identities = new Set<string>();
  let root: string;
  try { root = await realpath(directory); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") warnings.push(issue("unreadable-directory", resolve(directory), `Cannot read Course discovery directory: ${resolve(directory)}`)); return { courses: [], warnings }; }
  const warn = (value: CourseLoadIssue): void => { if (warnings.length < MAX_DISCOVERY_DIAGNOSTICS) warnings.push(value); };
  const walk = async (current: string, depth: number): Promise<void> => {
    let entries: Dirent<string>[];
    try { entries = await readdir(current, { withFileTypes: true }); } catch { warn(issue("unreadable-directory", current, `Cannot read Course discovery directory: ${current}`)); return; }
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      if (candidates.length >= MAX_DISCOVERED_CANDIDATES) return;
      const entryPath = join(current, entry.name);
      let canonical: string;
      try { canonical = await realpath(entryPath); } catch { warn(issue("unreadable-course", entryPath, `Cannot canonicalize discovery entry: ${entryPath}`)); continue; }
      if (!within(root, canonical)) { warn(issue("outside-discovery-root", entryPath, `Discovery symlink escapes Course root: ${entryPath}`)); continue; }
      let info: Awaited<ReturnType<typeof lstat>>;
      try { info = await lstat(entryPath); } catch { warn(issue("unreadable-course", entryPath, `Cannot inspect Course discovery entry: ${entryPath}`)); continue; }
      const target = await stat(canonical).catch(() => undefined);
      if (target?.isDirectory()) { if (depth < MAX_DISCOVERY_DEPTH) await walk(canonical, depth + 1); else warn(issue("unreadable-directory", entryPath, `Course discovery depth exceeds ${MAX_DISCOVERY_DEPTH}: ${entryPath}`)); continue; }
      if ((info.isFile() || info.isSymbolicLink()) && target?.isFile() && extname(entry.name).toLowerCase() === ".json" && !identities.has(canonical)) { identities.add(canonical); candidates.push(canonical); }
    }
  };
  await walk(root, 0);
  const courses: LoadedCourseFile[] = [];
  for (const path of candidates.sort(compare)) { const loaded = await loadCourseFile(path); if (loaded.ok) { courses.push(loaded.value); if (loaded.value.warnings.length) warn(issue("course-warning", path, `Course validator warnings for: ${path}`, [], loaded.value.warnings)); } else warn(loaded.issue); }
  return { courses, warnings: warnings.sort((a, b) => compare(a.sourcePath, b.sourcePath) || compare(a.code, b.code)) };
}
export function formatCourseLoadIssue(value: CourseLoadIssue): string { const details = [...value.diagnostics.map((v) => `${v.path}: ${v.message}`), ...value.warnings.map((v) => `${v.path}: ${v.message}`)]; return details.length === 0 ? value.message : `${value.message}\n${details.join("\n")}`; }
