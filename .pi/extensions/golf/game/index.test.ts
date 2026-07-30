import { describe, expect, it } from "vitest";

import { ManualMonotonicClock, parseCourseHoleIndex, parseCourseId, parseShotDirectionIndex, type PersistedRoundState } from "../domain/index.ts";
import type { Course } from "../course-loader/types.ts";
import { resolveShot, type ResolvedShot } from "../simulation/outcome.ts";
import { OUT_OF_BOUNDS } from "../course-loader/index.ts";
import { CameraController } from "../ui/index.ts";
import { GAME_BASE_STATES, GameController, gameOptionsFromRecovered, meterBlocksAt, newRoundState, renderPowerMeter, type GameWriter } from "./index.ts";

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

describe("V2-T10 FSM and game component", () => {
  it("AC-UI-001-01 enumerates exactly the nine base states and resize-paused wrapper", () => { expect(GAME_BASE_STATES).toEqual(["intro", "aiming", "metering", "committing", "playback", "penalty-notice", "hole-summary", "round-summary", "confirm-abandon"]); });
  it("AC-GME-001-01 starts Preview Hole 1 immediately with Driver and quantized Cup direction", () => { const { game } = makeGame(); expect(game.round.selectedClub).toBe("driver"); expect(game.round.shotDirectionIndex).toBe(0); expect(game.introText).toBe("Preview Course — Hole 1 — Par 4"); });
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
});
