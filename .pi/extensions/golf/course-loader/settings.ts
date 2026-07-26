import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export const PREVIEW_COURSE_ID = "preview-course";
export const PREVIEW_COURSE_SOURCE = "builtin:preview-course";

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
    text = await readFile(settingsPath, "utf8");
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
let temporaryFileSequence = 0;

async function writeSettingsAtomically(settingsPath: string, settings: CourseSettings): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  temporaryFileSequence += 1;
  const temporaryPath = `${settingsPath}.${process.pid}.${temporaryFileSequence}.tmp`;
  const contents = `${JSON.stringify(settings, null, 2)}\n`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, settingsPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/**
 * Serializes writes per project and commits each complete JSON document through
 * a same-directory rename, so overlapping UI changes cannot leave partial JSON.
 */
export async function writeCourseSettings(cwd: string, settings: CourseSettings): Promise<void> {
  if (!isCourseSettings(settings)) throw new Error("Refusing to persist invalid Golf settings.");
  const { settingsPath } = getCourseProjectPaths(cwd);
  const previous = pendingWrites.get(settingsPath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    await writeSettingsAtomically(settingsPath, settings);
  });
  pendingWrites.set(settingsPath, current);
  try {
    await current;
  } finally {
    if (pendingWrites.get(settingsPath) === current) pendingWrites.delete(settingsPath);
  }
}
