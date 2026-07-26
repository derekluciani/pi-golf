import type * as FileSystemPromises from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type * as SettingsModule from "./settings.ts";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type FileSystemPromisesModule = typeof FileSystemPromises;
type SettingsModuleType = typeof SettingsModule;

const fileSystemControl = vi.hoisted(() => ({
  coordinateTemporaryOpens: false,
  temporaryOpenAttempts: 0,
  firstTemporaryOwned: undefined as Promise<void> | undefined,
  markFirstTemporaryOwned: undefined as (() => void) | undefined,
  releaseFirstTemporaryOpen: undefined as Promise<void> | undefined,
  markFirstTemporaryReleased: undefined as (() => void) | undefined,
  failTemporaryWrite: false,
  failRename: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<FileSystemPromisesModule>();
  const failWrites = (handle: FileHandle): FileHandle => new Proxy(handle, {
    get(target, property) {
      if (property === "writeFile") {
        return async () => {
          throw new Error("injected temporary write failure");
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    ...actual,
    open: async (path: string, flags: string): Promise<FileHandle> => {
      if (!path.endsWith(".tmp") || !fileSystemControl.coordinateTemporaryOpens) {
        const handle = await actual.open(path, flags);
        if (!path.endsWith(".tmp") || !fileSystemControl.failTemporaryWrite) return handle;
        return failWrites(handle);
      }

      fileSystemControl.temporaryOpenAttempts += 1;
      const attempt = fileSystemControl.temporaryOpenAttempts;
      if (attempt === 2) await fileSystemControl.firstTemporaryOwned;

      let handle: FileHandle;
      try {
        handle = await actual.open(path, flags);
      } finally {
        if (attempt === 2) fileSystemControl.markFirstTemporaryReleased?.();
      }
      if (attempt === 1) {
        fileSystemControl.markFirstTemporaryOwned?.();
        await fileSystemControl.releaseFirstTemporaryOpen;
      }

      if (!fileSystemControl.failTemporaryWrite) return handle;
      return failWrites(handle);
    },
    rename: async (oldPath: string, newPath: string): Promise<void> => {
      if (fileSystemControl.failRename && oldPath.endsWith(".tmp")) {
        throw new Error("injected rename failure");
      }
      await actual.rename(oldPath, newPath);
    },
  };
});

const roots: string[] = [];

async function temporaryProject(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `pi-golf-settings-${label}-`));
  roots.push(root);
  return root;
}

async function settingsModules(): Promise<{
  first: SettingsModuleType;
  second: SettingsModuleType;
}> {
  vi.resetModules();
  const first = await import("./settings.ts");
  vi.resetModules();
  const second = await import("./settings.ts");
  return { first, second };
}

async function settingsDirectoryEntries(
  settings: SettingsModuleType,
  cwd: string,
): Promise<string[]> {
  return readdir(dirname(settings.getCourseProjectPaths(cwd).settingsPath));
}

afterEach(async () => {
  fileSystemControl.coordinateTemporaryOpens = false;
  fileSystemControl.temporaryOpenAttempts = 0;
  fileSystemControl.firstTemporaryOwned = undefined;
  fileSystemControl.markFirstTemporaryOwned = undefined;
  fileSystemControl.releaseFirstTemporaryOpen = undefined;
  fileSystemControl.markFirstTemporaryReleased = undefined;
  fileSystemControl.failTemporaryWrite = false;
  fileSystemControl.failRename = false;
  await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })));
  vi.resetModules();
});

describe("cross-runtime Course settings writes", () => {
  it("overlaps independent module instances without temp collisions or leaked partial JSON", async () => {
    const cwd = await temporaryProject("independent");
    const { first, second } = await settingsModules();
    const firstValue = { selectedCourseId: "first", sourcePath: "/first.json" };
    const secondValue = { selectedCourseId: "second", sourcePath: "/second.json" };
    fileSystemControl.coordinateTemporaryOpens = true;
    fileSystemControl.firstTemporaryOwned = new Promise((resolve) => {
      fileSystemControl.markFirstTemporaryOwned = resolve;
    });
    fileSystemControl.releaseFirstTemporaryOpen = new Promise((resolve) => {
      fileSystemControl.markFirstTemporaryReleased = resolve;
    });

    const results = await Promise.allSettled([
      first.writeCourseSettings(cwd, firstValue),
      second.writeCourseSettings(cwd, secondValue),
    ]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const settingsText = await readFile(first.getCourseProjectPaths(cwd).settingsPath, "utf8");
    expect(() => JSON.parse(settingsText) as unknown).not.toThrow();
    expect([firstValue, secondValue]).toContainEqual(JSON.parse(settingsText) as unknown);
    expect(await settingsDirectoryEntries(first, cwd)).toEqual(["settings.json"]);
  });

  it("preserves prior bytes and cleans only its unique temp after write and rename failures", async () => {
    const cwd = await temporaryProject("failures");
    const { first } = await settingsModules();
    const prior = { selectedCourseId: "prior", sourcePath: "/prior.json" };
    await first.writeCourseSettings(cwd, prior);
    const settingsPath = first.getCourseProjectPaths(cwd).settingsPath;
    const priorBytes = await readFile(settingsPath);

    fileSystemControl.failTemporaryWrite = true;
    await expect(first.writeCourseSettings(cwd, {
      selectedCourseId: "write-failure",
      sourcePath: "/write-failure.json",
    })).rejects.toThrow("injected temporary write failure");
    expect(await readFile(settingsPath)).toEqual(priorBytes);
    expect(await settingsDirectoryEntries(first, cwd)).toEqual(["settings.json"]);

    fileSystemControl.failTemporaryWrite = false;
    fileSystemControl.failRename = true;
    await expect(first.writeCourseSettings(cwd, {
      selectedCourseId: "rename-failure",
      sourcePath: "/rename-failure.json",
    })).rejects.toThrow("injected rename failure");
    expect(await readFile(settingsPath)).toEqual(priorBytes);
    expect(await settingsDirectoryEntries(first, cwd)).toEqual(["settings.json"]);
  });
});
