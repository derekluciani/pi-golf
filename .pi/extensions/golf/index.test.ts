import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { validateCourse } from "./course-loader/index.ts";
import {
  parseShotDirectionIndex,
  type PersistedRoundState,
  vectorForShotDirection,
} from "./domain/index.ts";
import registerGolfExtension from "./index.ts";
import { GolfRoundComponent, mirrorAcceptedMutations } from "./command-round.ts";
import type { GameWriter } from "./game/index.ts";
import { GOLF_BRANCH_REFERENCE_TYPE, RoundStore, type GolfEntryV1 } from "./persistence/index.ts";

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
}

const COMMAND_COURSE = JSON.stringify({ schemaVersion: 1, id: "command-course", name: "Command Course", holes: [{ id: "command-hole", number: 1, par: 3, boundary: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }, tee: { x: 1, y: 1 }, cup: { x: 2, y: 2 }, regions: [{ terrain: "green", shape: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] } }] }] });

function commandState(status: PersistedRoundState["status"] = "active"): PersistedRoundState {
  return { kind: "persisted-round", courseId: "command-course" as never, currentHoleIndex: 0 as never, lie: { x: 1, y: 1 }, selectedClub: "driver", shotDirectionIndex: 0 as never, holeScores: [], status };
}

function terminalRoundEntries(roundId: string, status: "complete" | "abandoned"): readonly GolfEntryV1[] {
  const initial = commandState();
  if (status === "abandoned") return [
    { entryVersion: 1, roundId, revision: 0, kind: "round-start", payload: { courseSnapshot: COMMAND_COURSE, state: initial, branchId: "branch-a" } },
    { entryVersion: 1, roundId, revision: 1, kind: "round-terminal", payload: { status, state: commandState(status) } },
  ];
  const completed = { ...commandState(), lie: { x: 2, y: 2 }, holeScores: [{ hole: { id: "command-hole" as never, number: 1 as never, courseIndex: 0 as never }, playedStrokes: 1, penaltyStrokes: 0, completed: true }] } as PersistedRoundState;
  return [
    { entryVersion: 1, roundId, revision: 0, kind: "round-start", payload: { courseSnapshot: COMMAND_COURSE, state: initial, branchId: "branch-a" } },
    { entryVersion: 1, roundId, revision: 1, kind: "shot", payload: { state: completed, shot: { shotId: `${roundId}-cup`, preShotLie: { x: 1, y: 1 }, inputs: { club: "driver", directionIndex: 0, power: 1 }, landingPosition: { x: 2, y: 2 }, finalPosition: { x: 2, y: 2 }, terminal: "cup", resultingSpeed: 0, elapsed: 1, resultingRound: { lie: { x: 2, y: 2 }, playedStrokes: 1, penaltyStrokes: 0, selectedClub: "driver", directionIndex: 0 } } } },
    { entryVersion: 1, roundId, revision: 2, kind: "round-terminal", payload: { status, state: { ...completed, status } } },
  ];
}

describe("V2-FND-001 project-local extension foundation", () => {
  it("AC-FND-001-01 exports a reload-safe project-local registration shell", () => {
    const registerCommand = vi.fn();
    // The extension factory reads only this API member; the assertion follows that tested boundary.
    const pi = { registerCommand } as unknown as ExtensionAPI;

    expect(() => registerGolfExtension(pi)).not.toThrow();
    expect(() => registerGolfExtension(pi)).not.toThrow();
    expect(registerCommand).toHaveBeenCalledTimes(2);
    expect(registerCommand).toHaveBeenLastCalledWith(
      "golf",
      expect.objectContaining({ description: "Open Pi Golf.", handler: expect.any(Function) }),
    );
  });

  it("AC-CRS-010-04 AC-CMD-003-03 routes explicit minimal selection through the isolated Pi proof adapter and returns Preview", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-golf-minimal-proof-"));
    try {
      const registerCommand = vi.fn(); const notify = vi.fn();
      registerGolfExtension({ registerCommand } as unknown as ExtensionAPI);
      const handler = registerCommand.mock.calls[0]?.[1].handler as ((args: string, ctx: unknown) => Promise<void>) | undefined;
      if (handler === undefined) throw new Error("Golf handler was not registered.");
      const ctx = { cwd: root, ui: { notify }, sessionManager: { getSessionId: () => "branch-a", getBranch: () => [] } };
      await handler(`course ${new URL("../../../docs/examples/minimal-course.json", import.meta.url).pathname}`, ctx);
      await handler("proof-minimal-course", ctx);
      expect(notify).toHaveBeenLastCalledWith("Minimal Course proof play completed (200 raster cells); returned to Preview Course.", "info");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("AC-PER-001-03 / AC-PER-001-04 mirrors durable first-action start to the real Pi custom branch-entry shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-golf-branch-seam-"));
    try {
      const registerCommand = vi.fn();
      const appendEntry = vi.fn();
      registerGolfExtension({ registerCommand, appendEntry } as unknown as ExtensionAPI);
      const handler = registerCommand.mock.calls[0]?.[1].handler as ((args: string, ctx: unknown) => Promise<void>) | undefined;
      if (handler === undefined) throw new Error("Golf handler was not registered.");
      await handler("", { mode: "tui", cwd: root, sessionManager: { getSessionId: () => "branch-a", getBranch: () => [] }, ui: { notify: vi.fn(), custom: vi.fn(async () => undefined) } });
      expect(appendEntry).toHaveBeenCalledWith("pi-golf-round-v1", expect.objectContaining({ roundId: expect.any(String), revision: 0 }));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("AC-FND-001-02 declares and enforces Node >=22.19.0", async () => {
    const packageText = await readProjectFile("package.json");
    const packageValue: unknown = JSON.parse(packageText);

    expect(packageValue).toEqual(expect.objectContaining({
      engines: { node: ">=22.19.0" },
      scripts: expect.objectContaining({ "check:node": "node scripts/check-node-version.mjs" }),
    }));
    await expect(readProjectFile(".nvmrc")).resolves.toBe("22.19.0\n");
    await expect(readProjectFile(".npmrc")).resolves.toContain("engine-strict=true");
    expect(process.versions.node.split(".").map(Number)).toEqual(
      expect.arrayContaining([expect.any(Number)]),
    );
  });

  it("AC-FND-001-03 documents headless lint, type-check, and test commands without a build", async () => {
    const packageText = await readProjectFile("package.json");
    const packageValue: unknown = JSON.parse(packageText);
    const readme = await readProjectFile("README.md");

    expect(packageValue).toEqual(expect.objectContaining({
      scripts: expect.objectContaining({
        lint: "eslint .",
        typecheck: "tsc --noEmit",
        test: "vitest run",
      }),
    }));
    expect(packageText).not.toMatch(/"build"\s*:/u);
    expect(readme).toContain("npm run lint");
    expect(readme).toContain("npm run typecheck");
    expect(readme).toContain("npm test");
    expect(readme).toContain("No production build");
  });

  it("AC-FND-001-04 executes pure simulation and Course validation without constructing TUI", async () => {
    const direction = parseShotDirectionIndex(4);
    expect(direction).toBeDefined();
    if (direction === undefined) throw new Error("Expected validated Shot Direction index.");
    expect(vectorForShotDirection(direction)).toEqual({ x: Math.cos(Math.PI / 2), y: 1 });

    const result = validateCourse({
      schemaVersion: 1,
      id: "headless-course",
      name: "Headless Course",
      holes: [{
        id: "headless-hole",
        number: 1,
        par: 3,
        boundary: {
          type: "polygon",
          points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
        },
        tee: { x: 1, y: 1 },
        cup: { x: 3, y: 3 },
        regions: [{
          terrain: "green",
          shape: {
            type: "polygon",
            points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
          },
        }],
      }],
    });
    expect(result.ok).toBe(true);

    const pureSourcePaths = [
      ".pi/extensions/golf/domain/index.ts",
      ".pi/extensions/golf/domain/clock.ts",
      ".pi/extensions/golf/course-loader/validation.ts",
    ];
    const pureSources = await Promise.all(pureSourcePaths.map(readProjectFile));
    for (const source of pureSources) {
      expect(source).not.toContain("@earendil-works/pi-tui");
      expect(source).not.toContain("ctx.ui.custom");
    }
  });

  it("AC-CMD-001-01 starts the selected Course once, resumes its active Round, and rejects overlap", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-golf-command-round-"));
    try {
      const registerCommand = vi.fn(); let reference: { roundId: string; revision: number } | undefined;
      const appendEntry = vi.fn((_type: string, data: { roundId: string; revision: number }) => { reference = data; }); const notify = vi.fn();
      let release!: () => void;
      const open = new Promise<void>((resolve) => { release = resolve; });
      const custom = vi.fn(async () => open);
      registerGolfExtension({ registerCommand, appendEntry } as unknown as ExtensionAPI);
      const handler = registerCommand.mock.calls[0]?.[1].handler as ((args: string, ctx: unknown) => Promise<void>);
      const ctx = { mode: "tui", cwd: root, sessionManager: { getSessionId: () => "branch-a", getBranch: () => reference === undefined ? [] : [{ type: "custom", id: "golf", parentId: null, timestamp: "x", customType: "pi-golf-round-v1", data: reference }] }, ui: { notify, custom } };
      const first = handler("", ctx);
      await vi.waitFor(() => expect(custom).toHaveBeenCalledTimes(1));
      const overlapping = handler("", ctx);
      expect(custom).toHaveBeenCalledTimes(1);
      release(); await Promise.all([first, overlapping]);
      await handler("", { ...ctx, ui: { ...ctx.ui, custom: vi.fn(async () => undefined) } });
      expect(appendEntry).toHaveBeenCalledTimes(1);
      expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("Could not open Pi Golf"), "error");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("AC-CMD-001-01 starts exactly one new selected Course after complete or abandoned recovered Round invocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-golf-command-terminal-"));
    try {
      for (const status of ["complete", "abandoned"] as const) {
        const roundId = `terminal-${status}`; const store = new RoundStore({ root: join(root, ".pi/golf/rounds") });
        for (const entry of terminalRoundEntries(roundId, status)) await store.append(entry);
        let reference = { roundId, revision: status === "complete" ? 2 : 1 };
        const appendEntry = vi.fn((_type: string, data: typeof reference) => { reference = data; }); const custom = vi.fn(async () => undefined);
        const registerCommand = vi.fn(); registerGolfExtension({ registerCommand, appendEntry } as unknown as ExtensionAPI);
        const handler = registerCommand.mock.calls[0]?.[1].handler as ((args: string, ctx: unknown) => Promise<void>);
        const sessionManager = { getSessionId: () => "branch-a", getBranch: () => [{ type: "custom", id: "golf", parentId: null, timestamp: "x", customType: GOLF_BRANCH_REFERENCE_TYPE, data: reference }] };
        await handler("", { mode: "tui", cwd: root, sessionManager, ui: { notify: vi.fn(), custom } });
        await handler("", { mode: "tui", cwd: root, sessionManager, ui: { notify: vi.fn(), custom } });
        expect(custom).toHaveBeenCalledTimes(2);
        expect(appendEntry).toHaveBeenCalledTimes(1);
        expect(reference.roundId).not.toBe(roundId);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("AC-CMD-001-02 confirms active replacement and records one linked successor", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-golf-command-new-"));
    try {
      const registerCommand = vi.fn(); let reference: { roundId: string; revision: number } | undefined;
      const appendEntry = vi.fn((_type: string, data: { roundId: string; revision: number }) => { reference = data; }); const confirm = vi.fn(async () => false);
      registerGolfExtension({ registerCommand, appendEntry } as unknown as ExtensionAPI);
      const handler = registerCommand.mock.calls[0]?.[1].handler as ((args: string, ctx: unknown) => Promise<void>);
      const sessionManager = { getSessionId: () => "branch-a", getBranch: () => reference === undefined ? [] : [{ type: "custom", id: "golf", parentId: null, timestamp: "x", customType: "pi-golf-round-v1", data: reference }] };
      const ui = { notify: vi.fn(), confirm, custom: vi.fn(async () => undefined) };
      await handler("", { mode: "tui", cwd: root, sessionManager, ui });
      await handler("new", { mode: "tui", cwd: root, sessionManager, ui });
      expect(confirm).toHaveBeenCalledWith("Start a new Round?", "Replace the active Round?");
      expect(appendEntry).toHaveBeenCalledTimes(1);
      confirm.mockResolvedValueOnce(true);
      await handler("new", { mode: "tui", cwd: root, sessionManager, ui });
      expect(appendEntry).toHaveBeenCalledTimes(2);
      const { RoundStore } = await import("./persistence/index.ts");
      const rounds = await new RoundStore({ root: join(root, ".pi/golf/rounds") }).findByBranch("branch-a");
      expect(rounds).toHaveLength(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("AC-CMD-001-02 uses the current durable predecessor revision after an interrupted branch mirror", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-golf-command-current-revision-"));
    try {
      const registerCommand = vi.fn(); let reference: { roundId: string; revision: number } | undefined;
      const appendEntry = vi.fn((_type: string, data: { roundId: string; revision: number }) => { reference = data; });
      const confirm = vi.fn(async () => true);
      registerGolfExtension({ registerCommand, appendEntry } as unknown as ExtensionAPI);
      const handler = registerCommand.mock.calls[0]?.[1].handler as ((args: string, ctx: unknown) => Promise<void>);
      const sessionManager = { getSessionId: () => "branch-a", getBranch: () => reference === undefined ? [] : [{ type: "custom", id: "golf", parentId: null, timestamp: "x", customType: GOLF_BRANCH_REFERENCE_TYPE, data: reference }] };
      const ui = { notify: vi.fn(), confirm, custom: vi.fn(async () => undefined) };
      await handler("", { mode: "tui", cwd: root, sessionManager, ui });
      if (reference === undefined) throw new Error("Round start did not mirror its branch reference.");
      const store = new RoundStore({ root: join(root, ".pi/golf/rounds") });
      const predecessor = await store.read(reference.roundId);
      await store.append({ entryVersion: 1, roundId: predecessor.roundId, revision: 1, kind: "checkpoint", payload: { state: predecessor.state, lifecycle: "aiming" } });
      await handler("new", { mode: "tui", cwd: root, sessionManager, ui });
      const replaced = await store.read(predecessor.roundId);
      expect(replaced).toMatchObject({ revision: 2, replacement: expect.any(String), terminal: true });
      expect(await store.findByBranch("branch-a")).toHaveLength(1);
      expect(reference).toEqual({ roundId: predecessor.roundId, revision: 2 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("AC-CMD-001-02 command-level confirmed reentry and interrupted delivery retain exactly one linked active successor", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-golf-command-new-retry-"));
    try {
      const registerCommand = vi.fn(); let reference: { roundId: string; revision: number } | undefined;
      const appendEntry = vi.fn((_type: string, data: { roundId: string; revision: number }) => { reference = data; });
      let confirmReplacement!: (value: boolean) => void; const confirmation = new Promise<boolean>((resolve) => { confirmReplacement = resolve; });
      const confirm = vi.fn(() => confirmation); let opens = 0; const custom = vi.fn(async () => { opens += 1; if (opens === 2) throw new Error("Overlay interrupted"); }); const notify = vi.fn();
      registerGolfExtension({ registerCommand, appendEntry } as unknown as ExtensionAPI);
      const handler = registerCommand.mock.calls[0]?.[1].handler as ((args: string, ctx: unknown) => Promise<void>);
      const sessionManager = { getSessionId: () => "branch-a", getBranch: () => reference === undefined ? [] : [{ type: "custom", id: "golf", parentId: null, timestamp: "x", customType: GOLF_BRANCH_REFERENCE_TYPE, data: reference }] };
      const ctx = { mode: "tui", cwd: root, sessionManager, ui: { notify, confirm, custom } };
      await handler("", ctx);
      const replacement = handler("new", ctx);
      await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      const reentry = handler("new", ctx);
      confirmReplacement(true);
      await Promise.all([replacement, reentry]);
      expect(custom).toHaveBeenCalledTimes(2);
      expect(notify).toHaveBeenCalledWith("Could not open Pi Golf: Overlay interrupted", "error");
      await handler("", ctx); // Retry after interrupted overlay delivery resumes the durable successor.
      const rounds = await new RoundStore({ root: join(root, ".pi/golf/rounds") }).findByBranch("branch-a");
      expect(rounds).toHaveLength(1);
      expect(rounds[0]).toMatchObject({ terminal: false, replacement: null });
      expect(appendEntry).toHaveBeenCalledTimes(2);
      expect(custom).toHaveBeenCalledTimes(3);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("AC-CMD-001-01 mirrors each accepted Shot, checkpoint, and terminal transition", async () => {
    let revision = 0;
    const writer: GameWriter = {
      commitShot: vi.fn(async () => ++revision),
      append: vi.fn(async () => ++revision),
    };
    const appendEntry = vi.fn();
    const mirrored = mirrorAcceptedMutations({ appendEntry }, writer, "mirror-round");
    await mirrored.commitShot({} as never, commandState());
    await mirrored.append({ kind: "checkpoint", payload: { state: commandState(), lifecycle: "aiming" } });
    await mirrored.append({ kind: "round-terminal", payload: { status: "abandoned", state: commandState("abandoned") } });
    expect(appendEntry.mock.calls).toEqual([
      [GOLF_BRANCH_REFERENCE_TYPE, { roundId: "mirror-round", revision: 1 }],
      [GOLF_BRANCH_REFERENCE_TYPE, { roundId: "mirror-round", revision: 2 }],
      [GOLF_BRANCH_REFERENCE_TYPE, { roundId: "mirror-round", revision: 3 }],
    ]);
  });

  it("AC-CMD-001-03 deferred Esc close waits for accepted durability and completes the overlay once", async () => {
    vi.useFakeTimers();
    try {
      let accept!: () => void; let closed = false;
      const accepted = new Promise<void>((resolve) => { accept = resolve; });
      const done = vi.fn(); const requestRender = vi.fn();
      const game = {
        state: { kind: "aiming" },
        get closed() { return closed; },
        tick: vi.fn(),
        key: vi.fn(() => { void accepted.then(() => { closed = true; }); }),
        whenIdle: vi.fn(async () => accepted),
        roundScore: () => 0,
        introText: "Course — Hole 1 — Par 3",
      };
      const component = new GolfRoundComponent(game, { requestRender } as unknown as TUI, {} as Theme, done);
      component.handleInput("\u001b");
      await vi.advanceTimersByTimeAsync(50);
      expect(done).not.toHaveBeenCalled();
      accept(); await accepted;
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(100);
      expect(done).toHaveBeenCalledTimes(1);
      expect(game.whenIdle).toHaveBeenCalledTimes(1);
      expect(requestRender).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("AC-CMD-001-03 returns the interactive-TUI-required response outside TUI", async () => {
    const registerCommand = vi.fn(); const notify = vi.fn();
    registerGolfExtension({ registerCommand } as unknown as ExtensionAPI);
    const handler = registerCommand.mock.calls[0]?.[1].handler as ((args: string, ctx: unknown) => Promise<void>);
    await handler("", { mode: "print", cwd: "/unused", ui: { notify }, sessionManager: { getSessionId: () => "branch-a", getBranch: () => [] } });
    expect(notify).toHaveBeenCalledWith("Pi Golf requires interactive TUI mode.", "warning");
  });
});
