import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readCourseSettings } from "./course-loader/index.ts";
import registerGolfExtension from "./index.ts";

interface RegisteredGolfCommand {
  readonly description: string;
  readonly handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })));
});

function register(): { command: RegisteredGolfCommand; registerCommand: ReturnType<typeof vi.fn> } {
  let command: RegisteredGolfCommand | undefined;
  const registerCommand = vi.fn((name: string, options: RegisteredGolfCommand) => {
    if (name === "golf") command = options;
  });
  const pi = { registerCommand } as unknown as ExtensionAPI;
  registerGolfExtension(pi);
  if (command === undefined) throw new Error("Golf command was not registered.");
  return { command, registerCommand };
}

function context(cwd: string, mode: "tui" | "print" = "print"): {
  readonly value: ExtensionCommandContext;
  readonly notify: ReturnType<typeof vi.fn>;
  readonly custom: ReturnType<typeof vi.fn>;
} {
  const notify = vi.fn();
  const custom = vi.fn();
  return {
    notify,
    custom,
    value: {
      cwd,
      mode,
      ui: { notify, custom },
    } as unknown as ExtensionCommandContext,
  };
}

async function temporaryProject(label: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), `pi-golf-command-${label}-`));
  roots.push(cwd);
  return cwd;
}

function validCourse(id: string): unknown {
  return {
    schemaVersion: 1,
    id,
    name: "Command Course",
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

describe("project-local extension entrypoint", () => {
  it("imports and registers its command on each reload", () => {
    const registerCommand = vi.fn();
    const pi = { registerCommand } as unknown as ExtensionAPI;

    expect(() => registerGolfExtension(pi)).not.toThrow();
    expect(() => registerGolfExtension(pi)).not.toThrow();
    expect(registerCommand).toHaveBeenCalledTimes(2);
    expect(registerCommand).toHaveBeenLastCalledWith(
      "golf",
      expect.objectContaining({ description: "Open Pi Golf." }),
    );
  });

  it("preserves the foundation response for empty and unrelated trimmed arguments", async () => {
    const cwd = await temporaryProject("foundation");
    const { command } = register();
    const first = context(cwd);
    await command.handler("   ", first.value);
    expect(first.notify).toHaveBeenCalledWith("Pi Golf foundation loaded.", "info");

    const second = context(cwd);
    await command.handler("  new  ", second.value);
    expect(second.notify).toHaveBeenCalledWith("Pi Golf foundation loaded.", "info");
  });

  it("returns clearly instead of opening replacement UI outside TUI mode", async () => {
    const cwd = await temporaryProject("non-tui");
    const { command } = register();
    const ctx = context(cwd, "print");
    await command.handler("  course  ", ctx.value);
    expect(ctx.custom).not.toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenCalledWith(
      "/golf course requires interactive TUI mode.",
      "warning",
    );
  });

  it("opens ordinary replacement custom UI for trimmed course in TUI mode", async () => {
    const cwd = await temporaryProject("tui");
    const { command } = register();
    const ctx = context(cwd, "tui");
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    } as unknown as Theme;
    ctx.custom.mockImplementation(async (factory: (
      tui: { requestRender: () => void },
      themeValue: Theme,
      keybindings: object,
      done: (value: undefined) => void,
    ) => { render: (width: number) => string[]; handleInput?: (data: string) => void }) => {
      const component = factory({ requestRender: vi.fn() }, theme, {}, vi.fn());
      expect(component.render(80)).toContain(" Golf Settings");
      component.handleInput?.("\u001b");
      return undefined;
    });

    await command.handler("\tcourse\t", ctx.value);
    expect(ctx.custom).toHaveBeenCalledOnce();
  });

  it("routes an explicit relative path with spaces and persists successful selection", async () => {
    const cwd = await temporaryProject("explicit");
    const sourcePath = join(cwd, "courses outside", "with spaces.json");
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, JSON.stringify(validCourse("command-course")), "utf8");
    const { command } = register();
    const ctx = context(cwd);

    await command.handler(" course   courses outside/with spaces.json ", ctx.value);
    expect((await readCourseSettings(cwd)).settings).toEqual({
      selectedCourseId: "command-course",
      sourcePath,
    });
    expect(ctx.notify).toHaveBeenCalledWith(
      "Command Course selected for the next new Round.",
      "info",
    );
  });

  it("reports a reserved explicit Course ID and preserves prior settings", async () => {
    const cwd = await temporaryProject("reserved");
    const priorPath = join(cwd, "prior.json");
    await writeFile(priorPath, JSON.stringify(validCourse("prior-course")), "utf8");
    const { command } = register();
    await command.handler("course prior.json", context(cwd).value);
    const before = (await readCourseSettings(cwd)).settings;

    const reservedPath = join(cwd, "reserved.json");
    await writeFile(reservedPath, JSON.stringify(validCourse("preview-course")), "utf8");
    const reservedContext = context(cwd);
    await command.handler("course reserved.json", reservedContext.value);

    expect(String(reservedContext.notify.mock.calls[0]?.[0])).toContain(
      "reserved by built-in content",
    );
    expect(reservedContext.notify.mock.calls[0]?.[1]).toBe("error");
    expect((await readCourseSettings(cwd)).settings).toEqual(before);
  });

  it("reports malformed JSON and every validator path without replacing settings", async () => {
    const cwd = await temporaryProject("errors");
    const malformedPath = join(cwd, "malformed.json");
    await writeFile(malformedPath, "{", "utf8");
    const invalidPath = join(cwd, "invalid.json");
    await writeFile(invalidPath, JSON.stringify({ schemaVersion: 8, id: "", name: "", holes: [] }), "utf8");
    const { command } = register();

    const malformedContext = context(cwd);
    await command.handler("course malformed.json", malformedContext.value);
    expect(malformedContext.notify.mock.calls[0]?.[0]).toContain("Malformed JSON");

    const invalidContext = context(cwd);
    await command.handler("course invalid.json", invalidContext.value);
    const message = String(invalidContext.notify.mock.calls[0]?.[0]);
    expect(message).toContain("$.schemaVersion");
    expect(message).toContain("$.id");
    expect(message).toContain("$.name");
    expect(message).toContain("$.holes");
    expect((await readCourseSettings(cwd)).exists).toBe(false);
  });
});
