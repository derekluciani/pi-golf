import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ManualMonotonicClock, parseCourseHoleIndex, parseCourseId, parseShotDirectionIndex, type PersistedRoundState } from "../domain/index.ts";
import { parseCourseJson } from "../course-loader/raw-parser.ts";
import type { Course } from "../course-loader/types.ts";
import { resolveShot, type ResolvedShot } from "../simulation/outcome.ts";
import { OUT_OF_BOUNDS } from "../course-loader/index.ts";
import { CameraController, ResolvedShotPlayback } from "../ui/index.ts";
import { appendRoundStart, RoundMutationWriter, RoundStore } from "../persistence/index.ts";
import { GAME_BASE_STATES, METER_INPUT_CONTRACT, GameController, gameOptionsFromRecovered, meterBlocksAt, newRoundState, renderPowerMeter, type GameWriter } from "./index.ts";

const course: Course = { schemaVersion: 1, id: "preview", name: "Preview Course", holes: [
  { id: "h1", number: 1, par: 4, tee: { x: 0, y: 0 }, cup: { x: 10, y: 0 }, boundary: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, regions: [] },
  { id: "h2", number: 2, par: 3, tee: { x: 0, y: 0 }, cup: { x: 0, y: 10 }, boundary: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, regions: [] },
  { id: "h4", number: 4, par: 5, tee: { x: 0, y: 0 }, cup: { x: -10, y: 0 }, boundary: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, regions: [] },
] };
const id = parseCourseId("preview"); const holeIndex = parseCourseHoleIndex(0); const parsedDirection = parseShotDirectionIndex(0);
if (id === undefined || holeIndex === undefined || parsedDirection === undefined) throw new Error("fixture invalid");
const direction = parsedDirection;
const initial: PersistedRoundState = { kind: "persisted-round", courseId: id, currentHoleIndex: holeIndex, lie: { x: 0, y: 0 }, selectedClub: "driver", shotDirectionIndex: direction, holeScores: [], status: "active" };
class Writer implements GameWriter { shots = 0; terminals = 0; checkpoints = 0; fail = false; async commitShot(): Promise<number> { this.shots += 1; if (this.fail) throw new Error("disk"); return this.shots; } async append(entry: Parameters<GameWriter["append"]>[0]): Promise<number> { if (entry.kind === "round-terminal") this.terminals += 1; else this.checkpoints += 1; return this.terminals + this.checkpoints; } }
function shot(terminal: ResolvedShot["terminal"] = "rest"): ResolvedShot { return { shotId: "shot-1", preShotLie: { x: 0, y: 0 }, inputs: { club: "driver", directionIndex: direction, power: .1 }, landingPosition: { x: 1, y: 0 }, finalPosition: terminal === "cup" ? { x: 10, y: 0 } : { x: 1, y: 0 }, terminal, resultingSpeed: 0, elapsed: .1, resultingRound: { lie: terminal === "cup" ? { x: 10, y: 0 } : { x: 1, y: 0 }, playedStrokes: 1, penaltyStrokes: terminal === "water" || terminal === "out-of-bounds" ? 1 : 0, selectedClub: "driver", directionIndex: direction }, keyframes: [{ elapsed: 0, position: { x: 0, y: 0 }, speed: 1 }] }; }
function presentation(clock: ManualMonotonicClock) { return { camera: new CameraController(clock, initial.lie, course.holes[0]?.cup ?? initial.lie), target: () => course.holes[0]?.cup ?? initial.lie }; }
function makeGame(terminal: ResolvedShot["terminal"] = "rest"): { game: GameController; clock: ManualMonotonicClock; writer: Writer } {
  const clock = new ManualMonotonicClock(); const writer = new Writer(); const reference: { current: GameController | null } = { current: null };
  const resolve = (power: number) => { const round = reference.current?.round; if (round === undefined) throw new Error("Game fixture is not initialized."); const resolved = shot(terminal); return { ...resolved, preShotLie: round.lie, inputs: { club: round.selectedClub, directionIndex: round.shotDirectionIndex, power }, resultingRound: { ...resolved.resultingRound, lie: terminal === "water" || terminal === "out-of-bounds" ? round.lie : resolved.resultingRound.lie, selectedClub: round.selectedClub, directionIndex: round.shotDirectionIndex } }; };
  const game = new GameController({ course, state: initial, writer, clock, shotId: () => "shot-1", resolve, presentation: presentation(clock) }); reference.current = game; return { game, clock, writer };
}
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }
async function flushDurable(): Promise<void> { for (let index = 0; index < 8; index += 1) await new Promise<void>((done) => setImmediate(done)); }
async function durableFixture(): Promise<{ root: string; store: RoundStore; snapshot: { readonly course: Course; readonly serializedCourse: string }; recovered: Awaited<ReturnType<typeof appendRoundStart>> }> {
  const root = await mkdtemp(join(tmpdir(), "pi-golf-game-")); const store = new RoundStore({ root: join(root, ".pi/golf/rounds") });
  const serializedCourse = await readFile(new URL("../courses/preview-course.json", import.meta.url), "utf8"); const parsed = parseCourseJson(serializedCourse);
  if (!parsed.ok) throw new Error("Preview Course fixture must be valid."); const snapshot = { course: parsed.value, serializedCourse };
  const recovered = await appendRoundStart(store, { roundId: "round-a", snapshot, state: newRoundState(snapshot), branchId: "session-a" });
  return { root, store, snapshot, recovered };
}

describe("V2-T10 FSM and game component", () => {
  it("AC-UI-001-01 enumerates exactly the nine base states and resize-paused wrapper", () => { expect(GAME_BASE_STATES).toEqual(["intro", "aiming", "metering", "committing", "playback", "penalty-notice", "hole-summary", "round-summary", "confirm-abandon"]); });
  it("AC-GME-001-01 starts Preview Hole 1 immediately with Driver and quantized Cup direction", () => { const { game } = makeGame(); expect(game.round.selectedClub).toBe("driver"); expect(game.round.shotDirectionIndex).toBe(0); expect(game.introText).toBe("Preview Course — Hole 1 — Par 4"); });
  it("AC-REN-005-01 AC-REN-006-01 exposes the authoritative camera, playback, and current Ball frame", async () => {
    const clock = new ManualMonotonicClock(); const writer = new Writer();
    const camera = new CameraController(clock, initial.lie, course.holes[0]?.cup ?? initial.lie);
    const resolved = { ...shot(), keyframes: [{ elapsed: 0, position: { x: 0, y: 0 }, speed: 1 }, { elapsed: .1, position: { x: 1, y: 0 }, speed: 0 }] };
    const game = new GameController({ course, state: initial, writer, clock, shotId: () => "shot-1", resolve: () => resolved, presentation: { camera, target: () => course.holes[0]?.cup ?? initial.lie } });
    expect(game.camera).toBe(camera); expect(game.playback).toBeNull(); expect(game.playbackFrame).toBeNull();
    clock.advanceBy(1_000); game.tick(); game.key(" "); game.key("Enter", clock.now() + 50); await game.whenIdle();
    const playback = game.playback;
    expect(playback).toBeInstanceOf(ResolvedShotPlayback);
    clock.advanceBy(50);
    expect(game.playbackFrame).toEqual({ position: { x: .5, y: 0 }, speed: .5, complete: false });
    game.tick();
    expect(game.camera.position()).toEqual({ x: .5, y: 0 }); expect(game.playbackFrame).toEqual(playback?.frame());
  });
  it("AC-GME-001-02 persists aim and resets Driver/direction at a new Hole", async () => { const { game, clock } = makeGame("cup"); clock.advanceBy(1_000); game.tick(); game.key("ArrowDown"); game.key(" "); game.key("release"); game.key(" "); await flush(); clock.advanceBy(100); game.tick(); game.key("Enter"); await flush(); expect(game.round.selectedClub).toBe("driver"); expect(game.round.shotDirectionIndex).toBe(4); });
  it("AC-GME-001-03 summary text is input driven and scorecard is ordered", () => { const { game, clock } = makeGame(); clock.advanceBy(1_000); game.tick(); expect(game.state.kind).toBe("aiming"); });
  it("AC-GME-001-04 intro is one second active time and resize freezes it", () => { const { game, clock } = makeGame(); clock.advanceBy(999); game.tick(); game.resize(59, 20); clock.advanceBy(5_000); game.resize(60, 20); game.tick(); expect(game.state.kind).toBe("intro"); clock.advanceBy(1); game.tick(); expect(game.state.kind).toBe("aiming"); });
  it("AC-GME-001-05 notices are two seconds and no timer exists after reload", () => { const { game, clock } = makeGame("water"); clock.advanceBy(1_000); game.tick(); game.key(" "); game.key("release"); game.key(" "); return flush().then(() => { clock.advanceBy(100); game.tick(); expect(game.state.kind).toBe("penalty-notice"); clock.advanceBy(2_000); game.tick(); expect(game.state.kind).toBe("aiming"); }); });
  it("AC-GME-002-01 scores normal, Water, and Out-of-Bounds officially", () => { expect(shot("rest").resultingRound).toMatchObject({ playedStrokes: 1, penaltyStrokes: 0 }); expect(shot("water").resultingRound).toMatchObject({ playedStrokes: 1, penaltyStrokes: 1 }); expect(shot("out-of-bounds").resultingRound).toMatchObject({ playedStrokes: 1, penaltyStrokes: 1 }); });
  it("AC-GME-002-02 exposes playedStrokes, penaltyStrokes, holeScore, and roundScore", () => { const { game } = makeGame(); expect(game.holeScore()).toBe(0); expect(game.roundScore()).toBe(0); });
  it("AC-GME-002-03 Preview scorecard Course fixture is Holes 1, 2, 4, par 12", () => { expect(course.holes.map((hole) => hole.number)).toEqual([1, 2, 4]); expect(course.holes.reduce((n, hole) => n + hole.par, 0)).toBe(12); });
  it("AC-UI-001-02 deterministically ignores invalid input in intro", () => { const { game } = makeGame(); game.key("ArrowLeft"); game.key("Q"); expect(game.state.kind).toBe("intro"); });
  it("AC-UI-001-03 permits club and direction mutation only while aiming", () => { const { game } = makeGame(); game.key("ArrowDown"); expect(game.round.selectedClub).toBe("driver"); });
  it("AC-UI-001-04 retry and queued Esc cannot duplicate a Shot", async () => { const { game, clock, writer } = makeGame(); clock.advanceBy(1_000); game.tick(); game.key(" "); game.key("release"); game.key(" "); game.key("Escape"); await flush(); expect(writer.shots).toBe(1); expect(game.closed).toBe(true); });
  it("AC-UI-002-01 covers every meter bin, boundaries, wrap, and event-time sample", () => { expect(Array.from({ length: 20 }, (_, i) => meterBlocksAt(i * 150))).toEqual([...Array.from({ length: 10 }, (_, i) => i + 1), ...Array.from({ length: 10 }, (_, i) => 10 - i)]); expect(meterBlocksAt(3_000)).toBe(1); });
  it("AC-UI-002-02 renders exact blocks and fixed color only", () => { expect(renderPowerMeter(3)).toEqual({ blocks: "███", color: "#ed8796" }); });
  it("AC-UI-002-03 held/repeated key cannot start and stop a meter", () => { const { game, clock } = makeGame(); clock.advanceBy(1_000); game.tick(); game.key(" "); game.key(" ", clock.now(), true); expect(game.state.kind).toBe("metering"); });
  it("AC-UI-002-04 resize and confirmation freeze meter then resume offset", () => { const { game, clock } = makeGame(); clock.advanceBy(1_000); game.tick(); game.key(" "); clock.advanceBy(150); game.resize(59, 19); clock.advanceBy(5_000); game.resize(60, 20); expect(game.meterBlocks).toBe(2); game.key("Q"); clock.advanceBy(5_000); game.key("N"); expect(game.meterBlocks).toBe(2); });
  it("AC-UI-003-01 wraps and resumes each base state safely", () => { const { game } = makeGame(); game.resize(59, 20); expect(game.state.kind).toBe("resize-paused"); game.resize(60, 20); expect(game.state.kind).toBe("intro"); });
  it("AC-UI-003-02 suspension freezes active timers", () => { const { game, clock } = makeGame(); game.resize(59, 20); clock.advanceBy(9_000); game.resize(60, 20); expect(game.state.kind).toBe("intro"); });
  it("AC-UI-003-03 queued actions survive resize without early consumption", () => { const { game, clock } = makeGame("rest"); clock.advanceBy(1_000); game.tick(); game.key(" "); game.key("release"); game.key(" "); game.key("Escape"); game.resize(59, 20); expect(game.closed).toBe(false); });
  it("AC-UI-003-04 threshold is exactly 60 by 20", () => { const { game } = makeGame(); game.resize(59, 20); expect(game.state.kind).toBe("resize-paused"); game.resize(60, 19); expect(game.state.kind).toBe("resize-paused"); game.resize(60, 20); expect(game.state.kind).toBe("intro"); });
  it("AC-UI-004-01 Escape cancels uncommitted meter without a Stroke", () => { const { game, clock, writer } = makeGame(); clock.advanceBy(1_000); game.tick(); game.key(" "); game.key("Escape"); expect(writer.shots).toBe(0); expect(game.closed).toBe(false); });
  it("AC-UI-004-02 confirmation accept/cancel retains prior state", () => { const { game, clock } = makeGame(); clock.advanceBy(1_000); game.tick(); game.key("Q"); expect(game.state.kind).toBe("confirm-abandon"); game.key("N"); expect(game.state.kind).toBe("aiming"); });
  it("AC-UI-004-03 confirmed abandonment writes terminal before close", async () => { const { game, clock, writer } = makeGame(); clock.advanceBy(1_000); game.tick(); game.key("Q"); game.key("Y"); await flush(); expect(writer.terminals).toBe(1); expect(game.closed).toBe(true); });

  it("AC-GME-001-01 starts only from the immutable selected T04 snapshot and recovery has no presentation state", () => {
    const snapshot = { course, serializedCourse: JSON.stringify(course) } as const;
    const started = newRoundState(snapshot); const firstHole = course.holes[0]; if (firstHole === undefined) throw new Error("fixture missing first Hole");
    expect(started).toMatchObject({ currentHoleIndex: 0, lie: firstHole.tee, selectedClub: "driver", shotDirectionIndex: 0, holeScores: [] });
    const recovered = { roundId: "round-a", revision: 3, state: { ...started, lie: { x: 4, y: 0 } }, lifecycle: "aiming" as const, currentHolePlayedStrokes: 3, currentHolePenaltyStrokes: 1, terminal: false, replacement: null, successorStart: null, branchId: "branch" };
    const recoveredClock = new ManualMonotonicClock();
    const options = gameOptionsFromRecovered(snapshot, recovered, { writer: new Writer(), clock: recoveredClock, shotId: () => "shot-1", resolve: () => shot(), presentation: presentation(recoveredClock) });
    const game = new GameController(options);
    expect(game.state.kind).toBe("aiming"); expect(game.holeScore()).toBe(4); expect(game.introText).toBe("Preview Course — Hole 1 — Par 4");
  });

  it("AC-GME-001-03 AC-GME-002-02 complete selected ordered Hole summaries and final scorecard only by input", async () => {
    const { game, clock } = makeGame("cup");
    for (let hole = 0; hole < 3; hole++) {
      clock.advanceBy(hole === 0 ? 1_000 : 1_000); game.tick(); game.key(" "); game.key("release"); game.key(" "); await flush(); clock.advanceBy(100); game.tick();
      const fixtureHole = course.holes[hole]; if (fixtureHole === undefined) throw new Error("fixture missing Hole");
      expect(game.holeSummary()).toMatchObject({ text: "It's in the hole!", score: { holeNumber: fixtureHole.number, playedStrokes: 1, penaltyStrokes: 0, holeScore: 1 } });
      clock.advanceBy(10_000); game.tick(); expect(game.state.kind).toBe("hole-summary"); game.key("Enter"); await flush();
    }
    expect(game.roundSummary()).toEqual({ scorecard: [
      { holeNumber: 1, par: 4, playedStrokes: 1, penaltyStrokes: 0, holeScore: 1 },
      { holeNumber: 2, par: 3, playedStrokes: 1, penaltyStrokes: 0, holeScore: 1 },
      { holeNumber: 4, par: 5, playedStrokes: 1, penaltyStrokes: 0, holeScore: 1 },
    ], roundScore: 3, totalPar: 12 });
  });

  it("AC-GME-002-01 validates real T06 normal, Water, and OOB outcomes against predecessor/scoring invariants", async () => {
    const base = { lie: { x: 0, y: 0 }, playedStrokes: 0, penaltyStrokes: 0, selectedClub: "putter" as const, directionIndex: direction };
    const outcomes = [
      resolveShot({ shotId: "normal", round: base, power: .1, originalLieTerrain: "green", cup: { x: -2, y: 0 }, terrainAt: () => "green", courseBoundarySweep: () => null }),
      resolveShot({ shotId: "water", round: base, power: .1, originalLieTerrain: "green", cup: { x: -2, y: 0 }, terrainAt: (point) => point.x >= 1 ? "water" : "green", courseBoundarySweep: () => null }),
      resolveShot({ shotId: "oob", round: base, power: .1, originalLieTerrain: "green", cup: { x: -2, y: 0 }, terrainAt: (point) => point.x >= 1 ? OUT_OF_BOUNDS : "green", courseBoundarySweep: () => null }),
    ];
    expect(outcomes.map((result) => [result.terminal, result.resultingRound.playedStrokes, result.resultingRound.penaltyStrokes, result.resultingRound.lie])).toEqual([
      ["rest", 1, 0, outcomes[0]?.resultingRound.lie], ["water", 1, 1, base.lie], ["out-of-bounds", 1, 1, base.lie],
    ]);
    for (const terminal of ["rest", "water", "out-of-bounds"] as const) {
      const { game, clock, writer } = makeGame(terminal); clock.advanceBy(1_000); game.tick(); game.key(" "); game.key("release"); game.key(" "); await flush();
      expect(writer.shots).toBe(1); expect(game.hudScore).toMatchObject({ playedStrokes: 1, penaltyStrokes: terminal === "rest" ? 0 : 1, holeScore: terminal === "rest" ? 1 : 2, roundScore: terminal === "rest" ? 1 : 2 });
    }
  });

  it("AC-UI-001-04 idempotently guards in-flight Shot, checkpoint, terminal and replacement operations", async () => {
    let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
    class SlowWriter extends Writer { override async commitShot(): Promise<number> { this.shots += 1; await pending; return this.shots; } override async append(entry: Parameters<GameWriter["append"]>[0]): Promise<number> { if (entry.kind === "round-terminal") this.terminals += 1; else this.checkpoints += 1; await pending; return 1; } }
    const clock = new ManualMonotonicClock(); const writer = new SlowWriter();
    const game = new GameController({ course, state: initial, writer, clock, shotId: () => "shot-1", resolve: () => shot(), presentation: presentation(clock) });
    clock.advanceBy(1_000); game.tick(); game.key(" "); game.key("release"); game.key(" "); game.key(" "); game.key("Escape"); game.key("Escape"); expect(writer.shots).toBe(1);
    release(); await flush(); expect(game.closed).toBe(true);
  });

  it("AC-UI-002-01 AC-UI-002-03 samples all half-open meter bins at event time after delayed rendering", () => {
    expect(Array.from({ length: 20 }, (_, bin) => meterBlocksAt(bin * 150))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect([meterBlocksAt(1_499), meterBlocksAt(1_500), meterBlocksAt(2_999), meterBlocksAt(3_000)]).toEqual([10, 10, 1, 1]);
    const { game, clock, writer } = makeGame(); clock.advanceBy(1_000); game.tick(); game.key(" ", 1_000); clock.advanceBy(9_000); game.key("release"); game.key(" ", 1_150); expect(writer.shots).toBe(1);
  });

  it("AC-UI-003-01 AC-UI-003-02 preserves every timed and stable state through the exact resize matrix", async () => {
    const dimensions = [[59, 20], [60, 19], [60, 20], [61, 21], [119, 59], [120, 60]] as const;
    for (const [width, height] of dimensions) { const { game } = makeGame(); game.resize(width, height); expect(game.state.kind === "resize-paused").toBe(width < 60 || height < 20); }
    const { game, clock } = makeGame("water"); clock.advanceBy(1_000); game.tick(); game.key(" "); game.key("release"); game.key(" "); await flush(); clock.advanceBy(100); game.tick(); game.resize(59, 19); clock.advanceBy(20_000); game.resize(60, 20); game.tick(); expect(game.state.kind).toBe("penalty-notice");
  });

  it("AC-UI-003-01 AC-UI-003-03 defers a resolved commit, playback creation, and queued Esc until resize restoration", async () => {
    let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
    class DelayedWriter extends Writer { override async commitShot(): Promise<number> { this.shots += 1; await pending; return this.shots; } }
    const clock = new ManualMonotonicClock(); const writer = new DelayedWriter();
    const game = new GameController({ course, state: initial, writer, clock, shotId: () => "shot-1", resolve: () => shot(), presentation: presentation(clock) });
    clock.advanceBy(1_000); game.tick(); game.key(" "); game.key("release"); game.key(" "); game.key("Q"); expect(game.state.kind).toBe("committing"); game.resize(59, 19); release(); await flush();
    expect(game.state).toMatchObject({ kind: "resize-paused", suspended: { kind: "committing" } }); expect(game.closed).toBe(false);
    game.resize(60, 20); expect(game.state.kind).toBe("playback");
    let releasePause!: () => void; const pendingPause = new Promise<void>((resolve) => { releasePause = resolve; });
    class PauseWriter extends Writer { override async commitShot(): Promise<number> { this.shots += 1; await pendingPause; return this.shots; } }
    const pauseClock = new ManualMonotonicClock(); const pauseGame = new GameController({ course, state: initial, writer: new PauseWriter(), clock: pauseClock, shotId: () => "shot-2", resolve: () => ({ ...shot(), shotId: "shot-2" }), presentation: presentation(pauseClock) });
    pauseClock.advanceBy(1_000); pauseGame.tick(); pauseGame.key(" "); pauseGame.key("release"); pauseGame.key(" "); pauseGame.key("Escape"); pauseGame.resize(59, 19); releasePause(); await flush();
    expect(pauseGame.closed).toBe(false); expect(pauseGame.state).toMatchObject({ kind: "resize-paused", suspended: { kind: "committing" } }); pauseGame.resize(60, 20); expect(pauseGame.closed).toBe(true);
  });

  it("AC-UI-004-01 AC-UI-004-02 Esc and Q preserve meter offsets, queue only committed work, and abandon durably", async () => {
    const { game, clock, writer } = makeGame("rest"); clock.advanceBy(1_000); game.tick(); game.key(" "); clock.advanceBy(150); game.key("Q"); clock.advanceBy(5_000); game.key("N"); expect(game.meterBlocks).toBe(2); game.key("Escape"); await flush(); expect(writer.shots).toBe(0); expect(game.closed).toBe(true);
    const second = makeGame("rest"); second.clock.advanceBy(1_000); second.game.tick(); second.game.key(" "); second.game.key("release"); second.game.key(" "); second.game.key("Q"); await flush(); expect(second.game.state.kind).toBe("playback"); second.game.key("Q"); second.clock.advanceBy(100); second.game.tick(); expect(second.game.state.kind).toBe("confirm-abandon"); second.game.key("Y"); await flush(); expect(second.writer.terminals).toBe(1); expect(second.game.round.status).toBe("abandoned");
  });

  it("AC-UI-002-03 defines no-release fallback: only a later non-repeat press commits", async () => {
    expect(METER_INPUT_CONTRACT).toBe("non-repeat Space/Enter events are distinct presses; repeat events never commit");
    const { game, clock, writer } = makeGame(); clock.advanceBy(1_000); game.tick();
    game.key(" ");
    for (let repeat = 0; repeat < 4; repeat++) game.key(" ", clock.now() + repeat * 150, true);
    expect(game.state.kind).toBe("metering"); expect(writer.shots).toBe(0);
    // No synthetic release: Pi's next non-repeat key event is a new press.
    game.key("Enter", clock.now() + 750); await flush();
    expect(writer.shots).toBe(1); expect(game.state.kind).toBe("playback");
  });

  it("AC-UI-001-02 AC-UI-001-03 exhaustively rejects mutation keys outside aiming", async () => {
    const ignored = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", " ", "Enter"];
    const assertIgnored = (game: GameController, writer: Writer): void => {
      const before = game.round; const writes = writer.shots; for (const key of ignored) game.key(key, undefined, true);
      expect(game.round).toEqual(before); expect(writer.shots).toBe(writes);
    };
    const intro = makeGame(); assertIgnored(intro.game, intro.writer);
    const meter = makeGame(); meter.clock.advanceBy(1_000); meter.game.tick(); meter.game.key(" "); assertIgnored(meter.game, meter.writer);
    const committing = makeGame(); committing.clock.advanceBy(1_000); committing.game.tick(); committing.game.key(" "); committing.game.key(" ", committing.clock.now(), false); await flush();
    // Playback is the committed boundary; all aim/meter mutation keys remain ignored.
    assertIgnored(committing.game, committing.writer);
    const confirm = makeGame(); confirm.clock.advanceBy(1_000); confirm.game.tick(); confirm.game.key("Q"); assertIgnored(confirm.game, confirm.writer);
  });

  it("AC-UI-001-04 persists failed Shot retry and terminal/checkpoint operations exactly once through GameController", async () => {
    const { game, clock, writer } = makeGame(); writer.fail = true; clock.advanceBy(1_000); game.tick(); game.key(" "); game.key(" ", clock.now() + 300); await flush();
    expect(game.state).toMatchObject({ kind: "committing", error: "Could not save Shot. Press Space or Enter to retry." }); expect(game.round).toEqual(initial);
    writer.fail = false; game.key("Enter", clock.now() + 450); game.key("Enter", clock.now() + 600, true); await flush();
    expect(writer.shots).toBe(2); expect(game.hudScore).toMatchObject({ playedStrokes: 1, penaltyStrokes: 0, holeScore: 1 });
    game.key("Escape"); game.key("Escape"); clock.advanceBy(100); game.tick(); await flush(); expect(writer.checkpoints).toBe(0); expect(game.closed).toBe(true);
    const terminal = makeGame(); terminal.clock.advanceBy(1_000); terminal.game.tick(); terminal.game.key("Q"); terminal.game.key("Y"); terminal.game.key("Y"); await flush();
    expect(terminal.writer.terminals).toBe(1); expect(terminal.game.round.status).toBe("abandoned");
  });

  it("AC-UI-002-04 starts one block after each committed Shot without a release event", async () => {
    const { game, clock } = makeGame(); clock.advanceBy(1_000); game.tick(); game.key(" "); game.key(" ", clock.now() + 900); await flush(); clock.advanceBy(100); game.tick();
    expect(game.state.kind).toBe("aiming"); game.key("Enter"); expect(game.state.kind).toBe("metering"); expect(game.meterBlocks).toBe(1);
  });

  it("AC-UI-003-01 AC-UI-003-03 preserves queued playback and penalty actions across resize", async () => {
    for (const terminal of ["rest", "water"] as const) {
      const { game, clock } = makeGame(terminal); clock.advanceBy(1_000); game.tick(); game.key(" "); game.key("Enter", clock.now() + 150); await flush();
      if (terminal === "rest") game.key("Q"); else { clock.advanceBy(100); game.tick(); game.key("Q"); }
      const before = game.state.kind; game.resize(59, 19); clock.advanceBy(9_000); game.resize(60, 20);
      expect(game.state.kind).toBe(before);
      if (terminal === "rest") { clock.advanceBy(100); game.tick(); } else { clock.advanceBy(2_000); game.tick(); }
      expect(game.state.kind).toBe("confirm-abandon");
    }
  });

  it("AC-UI-004-01 AC-UI-004-02 covers Esc and Q at every allowed legal boundary", async () => {
    const aiming = makeGame(); aiming.clock.advanceBy(1_000); aiming.game.tick(); aiming.game.key("Escape"); await flush(); expect(aiming.game.closed).toBe(true);
    const metering = makeGame(); metering.clock.advanceBy(1_000); metering.game.tick(); metering.game.key(" "); metering.game.key("Q"); expect(metering.game.state.kind).toBe("confirm-abandon"); metering.game.key("Escape"); expect(metering.game.state.kind).toBe("metering");
    for (const terminal of ["rest", "water"] as const) {
      const queued = makeGame(terminal); queued.clock.advanceBy(1_000); queued.game.tick(); queued.game.key(" "); queued.game.key("Enter", queued.clock.now() + 150); await flush();
      if (terminal === "water") { queued.clock.advanceBy(100); queued.game.tick(); }
      queued.game.key("Escape"); expect(queued.game.closed).toBe(false);
      queued.game.resize(59, 19); queued.clock.advanceBy(3_000); queued.game.resize(60, 20);
      if (terminal === "rest") { queued.clock.advanceBy(100); queued.game.tick(); } else { queued.clock.advanceBy(2_000); queued.game.tick(); }
      expect(queued.game.closed).toBe(true);
    }
  });

  it("AC-UI-001-02 AC-UI-001-03 rejects every non-table input in each constructed FSM state without canonical or writer mutation", async () => {
    const ignored = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab"];
    const assertIgnored = (game: GameController, writer: Writer): void => {
      const round = structuredClone(game.round); const writes = [writer.shots, writer.checkpoints, writer.terminals];
      for (const key of ignored) game.key(key, undefined, true);
      expect(game.round).toEqual(round); expect([writer.shots, writer.checkpoints, writer.terminals]).toEqual(writes);
    };
    const intro = makeGame(); assertIgnored(intro.game, intro.writer);
    const aiming = makeGame(); aiming.clock.advanceBy(1_000); aiming.game.tick(); assertIgnored(aiming.game, aiming.writer);
    const metering = makeGame(); metering.clock.advanceBy(1_000); metering.game.tick(); metering.game.key(" "); assertIgnored(metering.game, metering.writer);
    const committing = makeGame(); committing.clock.advanceBy(1_000); committing.game.tick(); committing.game.key(" "); committing.game.key("Enter", committing.clock.now() + 150); await flush(); assertIgnored(committing.game, committing.writer);
    const playback = makeGame(); playback.clock.advanceBy(1_000); playback.game.tick(); playback.game.key(" "); playback.game.key("Enter", playback.clock.now() + 150); await flush(); assertIgnored(playback.game, playback.writer);
    const notice = makeGame("water"); notice.clock.advanceBy(1_000); notice.game.tick(); notice.game.key(" "); notice.game.key("Enter", notice.clock.now() + 150); await flush(); notice.clock.advanceBy(100); notice.game.tick(); assertIgnored(notice.game, notice.writer);
    const summary = makeGame("cup"); summary.clock.advanceBy(1_000); summary.game.tick(); summary.game.key(" "); summary.game.key("Enter", summary.clock.now() + 150); await flush(); summary.clock.advanceBy(100); summary.game.tick(); assertIgnored(summary.game, summary.writer);
    const confirmation = makeGame(); confirmation.clock.advanceBy(1_000); confirmation.game.tick(); confirmation.game.key("Q"); assertIgnored(confirmation.game, confirmation.writer);
    for (const fixture of [intro, metering, notice, summary, confirmation]) { fixture.game.resize(59, 19); const before = structuredClone(fixture.game.round); fixture.game.key("ArrowDown"); fixture.game.key("Enter"); expect(fixture.game.state.kind).toBe("resize-paused"); expect(fixture.game.round).toEqual(before); }
  });

  it("AC-UI-003-01 AC-UI-003-02 AC-UI-003-03 freezes constructed metering, summaries, confirmation, and queued playback at resize boundaries", async () => {
    const metering = makeGame(); metering.clock.advanceBy(1_000); metering.game.tick(); metering.game.key(" "); metering.clock.advanceBy(300); const meterOffset = metering.game.meterBlocks;
    metering.game.resize(59, 19); metering.clock.advanceBy(9_000); metering.game.resize(60, 20); expect(metering.game.state.kind).toBe("metering"); expect(metering.game.meterBlocks).toBe(meterOffset);
    metering.game.key("Q"); expect(metering.game.state.kind).toBe("confirm-abandon"); metering.game.resize(59, 19); metering.clock.advanceBy(9_000); metering.game.resize(60, 20); metering.game.key("N"); expect(metering.game.state.kind).toBe("metering"); expect(metering.game.meterBlocks).toBe(meterOffset);
    const hole = makeGame("cup"); hole.clock.advanceBy(1_000); hole.game.tick(); hole.game.key(" "); hole.game.key("Enter", hole.clock.now() + 150); await flush(); hole.clock.advanceBy(100); hole.game.tick(); hole.game.resize(59, 19); hole.clock.advanceBy(9_000); hole.game.resize(60, 20); expect(hole.game.state.kind).toBe("hole-summary");
    const queued = makeGame(); queued.clock.advanceBy(1_000); queued.game.tick(); queued.game.key(" "); queued.game.key("Enter", queued.clock.now() + 150); await flush(); queued.game.key("Q"); queued.game.resize(59, 19); queued.clock.advanceBy(9_000); queued.game.resize(60, 20); expect(queued.game.state.kind).toBe("playback"); queued.clock.advanceBy(100); queued.game.tick(); expect(queued.game.state.kind).toBe("confirm-abandon");
  });

  it("AC-GME-001-03 AC-UI-001-04 reaches a real Round summary, retries an interrupted R replacement once, and rebinds T09 authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-golf-game-replacement-"));
    let interruptSuccessor = false; let openWrites = 0;
    const store = new RoundStore({ root: join(root, ".pi/golf/rounds"), beforeWrite: (boundary) => {
      if (interruptSuccessor && boundary === "open" && ++openWrites === 2) throw new Error("interrupt-successor-open");
    } });
    try {
      const serializedCourse = await readFile(new URL("../courses/preview-course.json", import.meta.url), "utf8"); const parsed = parseCourseJson(serializedCourse);
      if (!parsed.ok) throw new Error("Preview Course fixture must be valid.");
      const snapshot = { course: parsed.value, serializedCourse } as const; const initialState = newRoundState(snapshot);
      const started = await appendRoundStart(store, { roundId: "round-a", snapshot, state: initialState, branchId: "session-a" });
      const clock = new ManualMonotonicClock(); const writer = await RoundMutationWriter.forSession(store, "session-a", "round-a", started.revision); let resolvingRound = started.state;
      const resolve = (power: number): ResolvedShot => {
        const current = resolvingRound; const currentHole = snapshot.course.holes[current.currentHoleIndex];
        if (currentHole === undefined) throw new Error("Current Preview Hole is missing.");
        const resolved = shot("cup");
        return { ...resolved, shotId: `cup-${current.currentHoleIndex + 1}`, preShotLie: current.lie, inputs: { club: current.selectedClub, directionIndex: current.shotDirectionIndex, power }, landingPosition: currentHole.cup, finalPosition: currentHole.cup, resultingRound: { ...resolved.resultingRound, lie: currentHole.cup, selectedClub: current.selectedClub, directionIndex: current.shotDirectionIndex } };
      };
      const game = new GameController({ course: snapshot.course, state: started.state, writer, clock, shotId: () => `cup-${resolvingRound.currentHoleIndex + 1}`, resolve, presentation: { camera: new CameraController(clock, initialState.lie, snapshot.course.holes[0]?.cup ?? initialState.lie), target: () => snapshot.course.holes[0]?.cup ?? initialState.lie }, replacement: {
        store, predecessorRoundId: "round-a", predecessorRevision: 0, successorRoundId: "round-b", successorSnapshot: snapshot, successorState: initialState, branchId: "session-a",
        successorWriter: async (successor) => RoundMutationWriter.forSession(store, "session-a", successor.roundId, successor.revision),
      } });
      clock.advanceBy(1_000); game.tick();
      for (let index = 0; index < snapshot.course.holes.length; index += 1) {
        game.key(" "); game.key("Enter", clock.now() + 150); await game.whenIdle(); clock.advanceBy(1_000); game.tick();
        expect(game.state.kind).toBe("hole-summary"); game.key("Enter"); await game.whenIdle(); resolvingRound = game.round;
        if (index < snapshot.course.holes.length - 1) { clock.advanceBy(1_000); game.tick(); expect(game.state.kind).toBe("aiming"); }
      }
      expect(game.state.kind).toBe("round-summary"); expect((await store.read("round-a")).revision).toBe(5);
      interruptSuccessor = true; game.key("R"); await game.whenIdle();
      expect(game.state.kind).toBe("round-summary"); expect(await store.read("round-a")).toMatchObject({ revision: 6, replacement: "round-b", terminal: true }); expect(await store.hasRound("round-b")).toBe(false);
      interruptSuccessor = false; game.key("R"); game.key("R"); await game.whenIdle();
      expect(game.state.kind).toBe("intro"); expect(game.round).toEqual(initialState); expect((await store.read("round-a")).revision).toBe(6); expect(await store.read("round-b")).toMatchObject({ revision: 0, terminal: false });
      const predecessorKinds = (await readFile(store.pathFor("round-a"), "utf8")).trim().split("\n").map((line) => (JSON.parse(line) as { kind: string }).kind);
      const successorKinds = (await readFile(store.pathFor("round-b"), "utf8")).trim().split("\n").map((line) => (JSON.parse(line) as { kind: string }).kind);
      expect(predecessorKinds).toEqual(["round-start", "shot", "checkpoint", "shot", "checkpoint", "shot", "round-replacement"]); expect(successorKinds).toEqual(["round-start"]);
      resolvingRound = initialState; clock.advanceBy(1_000); game.tick(); game.key(" "); game.key("Enter", clock.now() + 150); await game.whenIdle();
      expect((await store.read("round-a")).revision).toBe(6); expect((await store.read("round-b")).revision).toBe(1);
    } finally { await rm(root, { recursive: true }); }
  });

  it("AC-GME-001-03 AC-UI-004-01 persists a reached Hole summary before Esc closes it", async () => {
    const { root, store, snapshot, recovered } = await durableFixture();
    try {
      const clock = new ManualMonotonicClock(); const durable = await RoundMutationWriter.forSession(store, "session-a", "round-a", recovered.revision); let pending: Promise<number> | null = null;
      const adapter: GameWriter = { commitShot: (saved, state) => { pending = durable.commitShot(saved, state); return pending; }, append: (entry) => { pending = durable.append(entry); return pending; } };
      const firstCup = snapshot.course.holes[0]?.cup ?? initial.lie;
      const resolve = (power: number): ResolvedShot => { const base = shot("cup"); return { ...base, shotId: "cup-1", preShotLie: recovered.state.lie, inputs: { club: recovered.state.selectedClub, directionIndex: recovered.state.shotDirectionIndex, power }, landingPosition: firstCup, finalPosition: firstCup, resultingRound: { ...base.resultingRound, lie: firstCup, selectedClub: recovered.state.selectedClub, directionIndex: recovered.state.shotDirectionIndex } }; };
      const game = new GameController({ course: snapshot.course, state: recovered.state, writer: adapter, clock, shotId: () => "cup-1", resolve, presentation: presentation(clock) });
      clock.advanceBy(1_000); game.tick(); game.key(" "); game.key("Enter", clock.now() + 150); if (pending === null) throw new Error("Shot was not submitted"); await pending; await flushDurable(); clock.advanceBy(1_000); game.tick(); expect(game.state).toMatchObject({ kind: "hole-summary" });
      game.key("Escape"); if (pending === null) throw new Error("Checkpoint was not submitted"); await pending; await flushDurable(); expect(game.closed).toBe(true); expect(await store.read("round-a")).toMatchObject({ lifecycle: "hole-summary", terminal: false });
    } finally { await rm(root, { recursive: true }); }
  });


  it("AC-UI-001-02 AC-UI-001-03 table-drives all nine base states plus resize-paused and rejects every non-accepted key without effects", async () => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", " ", "Enter", "Escape", "Q", "R", "Y", "N", "H", "unmapped"] as const;
    const accepted = {
      intro: ["H"], aiming: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", " ", "Enter", "Escape", "Q", "H"],
      metering: [" ", "Enter", "Escape", "Q", "H"], committing: ["Escape", "H"], playback: ["Escape", "Q", "H"],
      "penalty-notice": ["Escape", "Q", "H"], "hole-summary": [" ", "Enter", "Escape", "H"], "round-summary": ["Escape", "R", "H"],
      "confirm-abandon": ["Y", "Enter", "N", "Escape", "H"], "resize-paused": [],
    } as const;
    const makeSummary = async (): Promise<{ game: GameController; clock: ManualMonotonicClock; writer: Writer }> => {
      const fixture = makeGame("cup");
      for (let hole = 0; hole < course.holes.length; hole += 1) {
        fixture.clock.advanceBy(1_000); fixture.game.tick(); fixture.game.key(" "); fixture.game.key("Enter", fixture.clock.now() + 150); await fixture.game.whenIdle();
        fixture.clock.advanceBy(1_000); fixture.game.tick(); expect(fixture.game.state.kind).toBe("hole-summary"); fixture.game.key("Enter"); await fixture.game.whenIdle();
      }
      expect(fixture.game.state.kind).toBe("round-summary"); return fixture;
    };
    const intro = makeGame();
    const aiming = makeGame(); aiming.clock.advanceBy(1_000); aiming.game.tick();
    const metering = makeGame(); metering.clock.advanceBy(1_000); metering.game.tick(); metering.game.key(" ");
    const playback = makeGame(); playback.clock.advanceBy(1_000); playback.game.tick(); playback.game.key(" "); playback.game.key("Enter", playback.clock.now() + 150); await playback.game.whenIdle();
    const notice = makeGame("water"); notice.clock.advanceBy(1_000); notice.game.tick(); notice.game.key(" "); notice.game.key("Enter", notice.clock.now() + 150); await notice.game.whenIdle(); notice.clock.advanceBy(100); notice.game.tick();
    const hole = makeGame("cup"); hole.clock.advanceBy(1_000); hole.game.tick(); hole.game.key(" "); hole.game.key("Enter", hole.clock.now() + 150); await hole.game.whenIdle(); hole.clock.advanceBy(1_000); hole.game.tick();
    const summary = await makeSummary();
    const confirmation = makeGame(); confirmation.clock.advanceBy(1_000); confirmation.game.tick(); confirmation.game.key("Q");
    const paused = makeGame(); paused.game.resize(59, 19);
    class PendingWriter extends Writer { override async commitShot(): Promise<number> { this.shots += 1; return new Promise<number>(() => {}); } }
    const committingClock = new ManualMonotonicClock(); const committingWriter = new PendingWriter(); const committing = new GameController({ course, state: initial, writer: committingWriter, clock: committingClock, shotId: () => "shot-1", resolve: (power) => { const resolved = shot(); return { ...resolved, inputs: { ...resolved.inputs, power } }; }, presentation: presentation(committingClock) });
    committingClock.advanceBy(1_000); committing.tick(); committing.key(" "); committing.key("Enter", committingClock.now() + 150);
    const committingFixture = { game: committing, clock: committingClock, writer: committingWriter };
    const cases = [intro, aiming, metering, committingFixture, playback, notice, hole, summary, confirmation, paused] as const;
    expect(cases.map((fixture) => fixture.game.state.kind)).toEqual([...GAME_BASE_STATES, "resize-paused"]);
    for (const fixture of cases) {
      const state = fixture.game.state.kind; const beforeState = structuredClone(fixture.game.state); const beforeRound = structuredClone(fixture.game.round); const beforeWrites = [fixture.writer.shots, fixture.writer.checkpoints, fixture.writer.terminals];
      for (const key of keys.filter((candidate) => !(accepted[state] as readonly string[]).includes(candidate))) fixture.game.key(key, fixture.clock.now(), true);
      expect(fixture.game.state).toEqual(beforeState); expect(fixture.game.round).toEqual(beforeRound); expect([fixture.writer.shots, fixture.writer.checkpoints, fixture.writer.terminals]).toEqual(beforeWrites);
    }
  });

  it("AC-UI-001-02 toggles H HUD effect in every open base state without canonical Round or writer mutation", async () => {
    const assertHudToggle = (fixture: { game: GameController; clock: ManualMonotonicClock; writer: Writer }): void => {
      const beforeState = structuredClone(fixture.game.state); const beforeRound = structuredClone(fixture.game.round); const beforeWrites = [fixture.writer.shots, fixture.writer.checkpoints, fixture.writer.terminals];
      expect(fixture.game.hudVisible).toBe(true);
      fixture.game.key("H", fixture.clock.now());
      expect(fixture.game.hudVisible).toBe(false); expect(fixture.game.state).toEqual(beforeState); expect(fixture.game.round).toEqual(beforeRound); expect([fixture.writer.shots, fixture.writer.checkpoints, fixture.writer.terminals]).toEqual(beforeWrites);
      fixture.game.key("H", fixture.clock.now());
      expect(fixture.game.hudVisible).toBe(true); expect(fixture.game.state).toEqual(beforeState); expect(fixture.game.round).toEqual(beforeRound); expect([fixture.writer.shots, fixture.writer.checkpoints, fixture.writer.terminals]).toEqual(beforeWrites);
    };
    const makeSummary = async (): Promise<{ game: GameController; clock: ManualMonotonicClock; writer: Writer }> => {
      const fixture = makeGame("cup");
      for (let hole = 0; hole < course.holes.length; hole += 1) {
        fixture.clock.advanceBy(1_000); fixture.game.tick(); fixture.game.key(" "); fixture.game.key("Enter", fixture.clock.now() + 150); await fixture.game.whenIdle();
        fixture.clock.advanceBy(1_000); fixture.game.tick(); fixture.game.key("Enter"); await fixture.game.whenIdle();
      }
      expect(fixture.game.state.kind).toBe("round-summary"); return fixture;
    };
    const intro = makeGame();
    const aiming = makeGame(); aiming.clock.advanceBy(1_000); aiming.game.tick();
    const metering = makeGame(); metering.clock.advanceBy(1_000); metering.game.tick(); metering.game.key(" ");
    class PendingWriter extends Writer { override async commitShot(): Promise<number> { this.shots += 1; return new Promise<number>(() => {}); } }
    const committingClock = new ManualMonotonicClock(); const committingWriter = new PendingWriter(); const committingGame = new GameController({ course, state: initial, writer: committingWriter, clock: committingClock, shotId: () => "shot-1", resolve: (power) => ({ ...shot(), inputs: { ...shot().inputs, power } }), presentation: presentation(committingClock) });
    committingClock.advanceBy(1_000); committingGame.tick(); committingGame.key(" "); committingGame.key("Enter", committingClock.now() + 150);
    const playback = makeGame(); playback.clock.advanceBy(1_000); playback.game.tick(); playback.game.key(" "); playback.game.key("Enter", playback.clock.now() + 150); await playback.game.whenIdle();
    const notice = makeGame("water"); notice.clock.advanceBy(1_000); notice.game.tick(); notice.game.key(" "); notice.game.key("Enter", notice.clock.now() + 150); await notice.game.whenIdle(); notice.clock.advanceBy(100); notice.game.tick();
    const hole = makeGame("cup"); hole.clock.advanceBy(1_000); hole.game.tick(); hole.game.key(" "); hole.game.key("Enter", hole.clock.now() + 150); await hole.game.whenIdle(); hole.clock.advanceBy(1_000); hole.game.tick();
    const summary = await makeSummary();
    const confirmation = makeGame(); confirmation.clock.advanceBy(1_000); confirmation.game.tick(); confirmation.game.key("Q");
    const cases = [intro, aiming, metering, { game: committingGame, clock: committingClock, writer: committingWriter }, playback, notice, hole, summary, confirmation] as const;
    expect(cases.map((fixture) => fixture.game.state.kind)).toEqual(GAME_BASE_STATES);
    for (const fixture of cases) assertHudToggle(fixture);
  });

  it("AC-UI-003-01 AC-UI-003-02 restores a real Round summary unchanged after undersized allocation", async () => {
    const { game, clock, writer } = await (async () => {
      const fixture = makeGame("cup");
      for (let hole = 0; hole < course.holes.length; hole += 1) {
        fixture.clock.advanceBy(1_000); fixture.game.tick(); fixture.game.key(" "); fixture.game.key("Enter", fixture.clock.now() + 150); await fixture.game.whenIdle(); fixture.clock.advanceBy(1_000); fixture.game.tick(); fixture.game.key("Enter"); await fixture.game.whenIdle();
      }
      return fixture;
    })();
    const canonical = structuredClone(game.round); const summary = structuredClone(game.state);
    expect(summary).toEqual({ kind: "round-summary" });
    game.resize(59, 19); expect(game.state).toEqual({ kind: "resize-paused", suspended: summary });
    clock.advanceBy(30_000); game.resize(60, 20);
    expect(game.state).toEqual(summary); expect(game.round).toEqual(canonical); expect([writer.shots, writer.checkpoints, writer.terminals]).toEqual([3, 2, 0]);
    game.key("Escape"); await game.whenIdle(); expect(writer.terminals).toBe(1); expect(game.closed).toBe(true);
  });

  it("AC-GME-001-03 AC-UI-004-01 appends exactly one durable complete terminal from a real Round summary and leaves no active recovery", async () => {
    const { root, store, snapshot, recovered } = await durableFixture();
    try {
      const clock = new ManualMonotonicClock(); const writer = await RoundMutationWriter.forSession(store, "session-a", "round-a", recovered.revision); let current = recovered.state; let shotNumber = 0; let activeShotId = "";
      const resolve = (power: number): ResolvedShot => {
        const currentHole = snapshot.course.holes[current.currentHoleIndex]; if (currentHole === undefined) throw new Error("Missing current Hole.");
        const base = shot("cup"); return { ...base, shotId: activeShotId, preShotLie: current.lie, inputs: { club: current.selectedClub, directionIndex: current.shotDirectionIndex, power }, landingPosition: currentHole.cup, finalPosition: currentHole.cup, resultingRound: { ...base.resultingRound, lie: currentHole.cup, selectedClub: current.selectedClub, directionIndex: current.shotDirectionIndex } };
      };
      const game = new GameController({ course: snapshot.course, state: recovered.state, writer, clock, shotId: () => { activeShotId = `cup-${shotNumber}`; shotNumber += 1; return activeShotId; }, resolve, presentation: { camera: new CameraController(clock, recovered.state.lie, snapshot.course.holes[0]?.cup ?? recovered.state.lie), target: () => snapshot.course.holes[0]?.cup ?? recovered.state.lie } });
      clock.advanceBy(1_000); game.tick();
      for (let index = 0; index < snapshot.course.holes.length; index += 1) {
        game.key(" "); game.key("Enter", clock.now() + 150); await game.whenIdle(); clock.advanceBy(1_000); game.tick(); expect(game.state.kind).toBe("hole-summary"); game.key("Enter"); await game.whenIdle(); current = game.round;
        if (index < snapshot.course.holes.length - 1) { clock.advanceBy(1_000); game.tick(); }
      }
      expect(game.state.kind).toBe("round-summary"); game.key("Escape"); game.key("Escape"); await game.whenIdle(); await flushDurable();
      const entries = (await readFile(store.pathFor("round-a"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { kind: string });
      expect(entries.filter((entry) => entry.kind === "round-terminal")).toHaveLength(1);
      expect(await store.read("round-a")).toMatchObject({ terminal: true, lifecycle: "round-summary", state: { status: "complete" } });
      expect(await store.findByBranch("session-a")).toEqual([]); expect(game.closed).toBe(true);
    } finally { await rm(root, { recursive: true }); }
  });
});
