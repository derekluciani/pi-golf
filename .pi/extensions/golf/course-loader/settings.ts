import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";

export const MAX_SETTINGS_BYTES = 16 * 1024;
import { dirname, isAbsolute, join } from "node:path";

export const PREVIEW_COURSE_ID = "preview-course";
export const PREVIEW_COURSE_SOURCE = "builtin:preview-course";

const RESERVED_BUILT_IN_COURSE_IDS: ReadonlySet<string> = new Set([PREVIEW_COURSE_ID]);

/** Keeps every external-loading path aligned with the IDs owned by built-in content. */
export function isReservedBuiltInCourseId(courseId: string): boolean {
  return RESERVED_BUILT_IN_COURSE_IDS.has(courseId);
}

export interface CourseSettings {
  readonly selectedCourseId: string;
  readonly sourcePath: string;
}

export const PREVIEW_COURSE_SETTINGS: CourseSettings = {
  selectedCourseId: PREVIEW_COURSE_ID,
  sourcePath: PREVIEW_COURSE_SOURCE,
};

export type CourseSettingsIssueCode =
  | "invalid-settings"
  | "malformed-settings"
  | "unreadable-settings";

export interface CourseSettingsIssue {
  readonly code: CourseSettingsIssueCode;
  readonly settingsPath: string;
  readonly message: string;
}

export interface CourseSettingsReadResult {
  readonly settings: CourseSettings;
  readonly warning: CourseSettingsIssue | undefined;
  readonly exists: boolean;
}

/** Testable interruption seam; production callers do not provide hooks. */
export interface CourseSettingsWriteHooks {
  readonly beforeRename?: (temporaryPath: string) => Promise<void> | void;
}

async function readBoundedFile(path: string, maximumBytes: number): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes) throw new Error("file exceeds bound");
    const bytes = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== bytes.byteLength || after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs) throw new Error("file changed while read");
    return bytes;
  } finally { await handle.close(); }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCourseSettings(value: unknown): value is CourseSettings {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 2
    && keys[0] === "selectedCourseId"
    && keys[1] === "sourcePath"
    && typeof value.selectedCourseId === "string"
    && /\S/u.test(value.selectedCourseId)
    && typeof value.sourcePath === "string"
    && /\S/u.test(value.sourcePath)
    && (value.sourcePath === PREVIEW_COURSE_SOURCE || isAbsolute(value.sourcePath));
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}

/** Returns all project-local Course paths using Pi's configured directory brand. */
export function getCourseProjectPaths(cwd: string): {
  readonly golfDirectory: string;
  readonly coursesDirectory: string;
  readonly settingsPath: string;
} {
  const golfDirectory = join(cwd, CONFIG_DIR_NAME, "golf");
  return {
    golfDirectory,
    coursesDirectory: join(golfDirectory, "courses"),
    settingsPath: join(golfDirectory, "settings.json"),
  };
}

/** Treats persisted JSON as unknown and deterministically falls back to Preview. */
export async function readCourseSettings(cwd: string): Promise<CourseSettingsReadResult> {
  const { settingsPath } = getCourseProjectPaths(cwd);
  let text: string;
  try {
    const bytes = await readBoundedFile(settingsPath, MAX_SETTINGS_BYTES);
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return { settings: PREVIEW_COURSE_SETTINGS, warning: undefined, exists: false };
    }
    return {
      settings: PREVIEW_COURSE_SETTINGS,
      exists: true,
      warning: {
        code: "unreadable-settings",
        settingsPath,
        message: `Cannot read Golf settings; using Preview Course: ${settingsPath}`,
      },
    };
  }

  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    return {
      settings: PREVIEW_COURSE_SETTINGS,
      exists: true,
      warning: {
        code: "malformed-settings",
        settingsPath,
        message: `Malformed Golf settings JSON; using Preview Course: ${settingsPath}`,
      },
    };
  }

  if (!isCourseSettings(input)) {
    return {
      settings: PREVIEW_COURSE_SETTINGS,
      exists: true,
      warning: {
        code: "invalid-settings",
        settingsPath,
        message: `Invalid Golf settings; using Preview Course: ${settingsPath}`,
      },
    };
  }
  return { settings: input, warning: undefined, exists: true };
}

const pendingWrites = new Map<string, Promise<void>>();
const LOCK_RETRY_COUNT = 100;
const LOCK_RETRY_MILLISECONDS = 5;

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolvePause) => { setTimeout(resolvePause, milliseconds); });
}

/** An exclusive same-directory lock coordinates separately loaded extension runtimes. */
async function acquireSettingsLock(settingsPath: string): Promise<() => Promise<void>> {
  const lockPath = `${settingsPath}.lock`;
  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
    try {
      const lock = await open(lockPath, "wx");
      await lock.close();
      return async () => { await rm(lockPath, { force: true }); };
    } catch (error: unknown) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      await pause(LOCK_RETRY_MILLISECONDS);
    }
  }
  throw new Error("Timed out waiting to write Golf settings.");
}

async function writeSettingsAtomically(settingsPath: string, settings: CourseSettings, hooks: CourseSettingsWriteHooks): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  const releaseLock = await acquireSettingsLock(settingsPath);
  const temporaryPath = `${settingsPath}.${process.pid}.${randomUUID()}.tmp`;
  const contents = `${JSON.stringify(settings, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_SETTINGS_BYTES) throw new Error("Golf settings exceed 16 KiB.");
  let ownsTemporaryPath = false;
  let temporaryFile: Awaited<ReturnType<typeof open>> | undefined;

  try {
    // Exclusive creation establishes ownership before any content is written.
    // A reloaded runtime therefore cannot remove another writer's artifact.
    temporaryFile = await open(temporaryPath, "wx");
    ownsTemporaryPath = true;
    await temporaryFile.writeFile(contents, { encoding: "utf8" });
    await temporaryFile.sync();
    await temporaryFile.close();
    temporaryFile = undefined;
    await hooks.beforeRename?.(temporaryPath);
    await rename(temporaryPath, settingsPath);
    // Best effort: some platforms do not permit opening/syncing directories.
    const directory = await open(dirname(settingsPath), "r").catch(() => undefined);
    await directory?.sync().catch(() => undefined);
    await directory?.close().catch(() => undefined);
  } finally {
    await temporaryFile?.close().catch(() => undefined);
    if (ownsTemporaryPath) await rm(temporaryPath, { force: true });
    await releaseLock();
  }
}

/**
 * Serializes writes from this runtime and commits each complete JSON document
 * through a uniquely owned same-directory temporary file and atomic rename.
 */
export async function writeCourseSettings(cwd: string, settings: CourseSettings, hooks: CourseSettingsWriteHooks = {}): Promise<void> {
  if (!isCourseSettings(settings)) throw new Error("Refusing to persist invalid Golf settings.");
  const { settingsPath } = getCourseProjectPaths(cwd);
  const previous = pendingWrites.get(settingsPath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    await writeSettingsAtomically(settingsPath, settings, hooks);
  });
  pendingWrites.set(settingsPath, current);
  try {
    await current;
  } finally {
    if (pendingWrites.get(settingsPath) === current) pendingWrites.delete(settingsPath);
  }
}
