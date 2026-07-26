import {
  initTheme,
  type ExtensionCommandContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getCourseProjectPaths, readCourseSettings, showCourseSettings } from "./index.ts";

const roots: string[] = [];

beforeAll(() => {
  initTheme("dark", false);
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })));
});

function validCourse(): unknown {
  return {
    schemaVersion: 1,
    id: "ui-selected",
    name: "UI Selected Course",
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
        shape: { type: "ellipse", center: { x: 7, y: 7 }, radiusX: 1, radiusY: 1 },
      }],
    }],
  };
}

describe("Golf Settings persistence", () => {
  it("serializes a successful SettingsList change before the replacement UI returns", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-golf-ui-persistence-"));
    roots.push(cwd);
    const sourcePath = join(getCourseProjectPaths(cwd).coursesDirectory, "custom.json");
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, JSON.stringify(validCourse()), "utf8");

    const notify = vi.fn();
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    } as unknown as Theme;
    const custom = vi.fn(async (factory: (
      tui: { requestRender: () => void },
      themeValue: Theme,
      keybindings: object,
      done: (value: undefined) => void,
    ) => { handleInput?: (data: string) => void }) => {
      const component = factory({ requestRender: vi.fn() }, theme, {}, vi.fn());
      component.handleInput?.(" ");
      component.handleInput?.("\u001b");
      return undefined;
    });
    const ctx = {
      cwd,
      mode: "tui",
      ui: { custom, notify },
    } as unknown as ExtensionCommandContext;

    await showCourseSettings(ctx);

    expect((await readCourseSettings(cwd)).settings).toEqual({
      selectedCourseId: "ui-selected",
      sourcePath,
    });
    expect(notify).toHaveBeenCalledWith(
      "UI Selected Course selected for the next new Round.",
      "info",
    );
  });
});
