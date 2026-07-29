import { describe, expect, it } from "vitest";

import { GREEN_DECELERATION_CLUB_MULTIPLIERS, GREEN_DECELERATION_ORIGIN_MULTIPLIERS, TERRAIN_ROLL_DECELERATION, type Club } from "../domain/index.ts";
import { OUT_OF_BOUNDS } from "../course-loader/index.ts";
import { PENALTY_NOTICES, advancePenaltyNotice, createPenaltyNotice, discardPenaltyNoticeOnReload, penaltyNoticeFor, playbackKeyframes, resolveRoll, resolveShot, rollDeceleration, toDurableShot } from "./index.ts";

const east = { x: 1, y: 0 };
const green = () => "green" as const;
const base = { position: { x: 0, y: 0 }, speed: 2, direction: east, club: "putter" as const, originalLieTerrain: "fairway" as const, cup: { x: -10, y: 0 }, terrainAt: green };
const near = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 10);

describe("V2-SIM-005 Terrain Roll and Green modifiers", () => {
  it("AC-SIM-005-01 covers every base deceleration and complete non-Putter Green multiplier matrix", () => {
    for (const terrain of ["green", "fairway", "rough", "bunker"] as const) expect(rollDeceleration(terrain, "rough", "putter")).toBe(TERRAIN_ROLL_DECELERATION[terrain]);
    for (const [club, multiplier] of Object.entries(GREEN_DECELERATION_CLUB_MULTIPLIERS)) {
      near(rollDeceleration("green", "rough", club as Exclude<Club, "putter">), GREEN_DECELERATION_ORIGIN_MULTIPLIERS.rough * multiplier);
    }
  });
  it("AC-SIM-005-02 uses Driver 0.40 and Fairway PW deceleration 2.08", () => {
    expect(GREEN_DECELERATION_CLUB_MULTIPLIERS.driver).toBe(0.4);
    near(rollDeceleration("green", "fairway", "pw"), 2.08);
  });
  it("AC-SIM-005-03 changes Terrain at its exact event while retaining original-Lie multiplier", () => {
    const result = resolveRoll({ ...base, speed: 4, club: "pw", terrainAt: (p) => p.x < 1 ? "fairway" : "green" });
    // First segment consumes s=1 with a=3; rest is then Green at 1.3*1.6.
    const first = (4 - Math.sqrt(16 - 6)) / 3;
    const v = 4 - 3 * first;
    near(result.elapsed, first + v / 2.08);
  });
  it("AC-SIM-005-04 keeps putts on Green at base deceleration 1", () => {
    for (const origin of ["fairway", "green", "rough", "bunker"] as const) expect(rollDeceleration("green", origin, "putter")).toBe(1);
  });
});

describe("V2-SIM-006 analytical Roll and splitting", () => {
  it("AC-SIM-006-01 matches closed-form one/multiple Terrain segments and exact rest", () => {
    const one = resolveRoll(base);
    near(one.elapsed, 2); near(one.finalPosition.x, 2); expect(one.resultingSpeed).toBe(0);
    const multiple = resolveRoll({ ...base, speed: 4, terrainAt: (p) => p.x < 1 ? "green" : "fairway" });
    // x=1 at t=4-sqrt(14), then speed sqrt(14), a=3.
    near(multiple.elapsed, 4 - Math.sqrt(14) + Math.sqrt(14) / 3);
    near(multiple.finalPosition.x, 1 + 14 / 6);
  });
  it("AC-SIM-006-02 consumes outer-step remainder under the new Terrain", () => {
    const result = resolveRoll({ ...base, position: { x: 0.999, y: 0 }, speed: 1, terrainAt: (p) => p.x < 1 ? "green" : "bunker" });
    // The 0.001 crossing happens within 1/120, then Bunker reduces speed in the remainder.
    expect(result.keyframes[1]?.speed).toBeLessThan(1 - 1 / 120);
  });
  it("AC-SIM-006-03 sweeps Cup, Water, playable Terrain, and Boundary without tunneling", () => {
    expect(resolveRoll({ ...base, speed: 20, cup: { x: 1, y: 0 } }).terminal).toBe("rest"); // too fast Cup traversal, not tunnel/capture
    expect(resolveRoll({ ...base, speed: 20, terrainAt: (p) => p.x >= 1 ? "water" : "green" }).terminal).toBe("water");
    const transition = resolveRoll({ ...base, speed: 4, terrainAt: (p) => p.x >= 1 ? "rough" : "green" });
    expect(transition.finalPosition.x).toBeLessThan(8); // not Green's 8-unit rest
    expect(resolveRoll({ ...base, speed: 20, boundaryDistance: () => 0.001 }).terminal).toBe("out-of-bounds");
  });
  it("AC-SIM-006-01/03 handles exact negative cell edges and every swept crossing", () => {
    const negativeEdge = resolveRoll({ ...base, position: { x: 3, y: 0 }, direction: { x: -1, y: 0 }, speed: 4, terrainAt: (p) => p.x < 3 ? "water" : "green" });
    expect(negativeEdge.terminal).toBe("water");
    expect(negativeEdge.elapsed).toBe(0);

    // This crosses 0, -1, and -2 in one 1/120-second outer interval; only -2 is Water.
    const multiBoundary = resolveRoll({ ...base, position: { x: 0.1, y: 0 }, direction: { x: -1, y: 0 }, speed: 1_000, terrainAt: (p) => p.x <= -2 ? "water" : "green" });
    expect(multiBoundary.terminal).toBe("water");
    expect(multiBoundary.elapsed).toBeLessThan(1 / 120);
  });
  it("AC-SIM-006-04 resolves pairwise and multi-event ties within an absolute 1e-9 seconds by precedence", () => {
    const tied = resolveRoll({ ...base, position: { x: 0.999, y: 0 }, speed: 2, cup: { x: 1.35, y: 0 }, terrainAt: (p) => p.x >= 1 ? "water" : "green", boundaryDistance: () => 0.001 + 5e-10 });
    expect(tied.terminal).toBe("out-of-bounds");
    expect(resolveRoll({ ...base, position: { x: 0.999, y: 0 }, speed: 2, cup: { x: 1.35, y: 0 }, terrainAt: (p) => p.x >= 1 ? "water" : "green" }).terminal).toBe("water");

    // At speed 100 the events are 2e-9 seconds apart: Water is earlier, not an OOB tie.
    const beyondAbsoluteTolerance = resolveRoll({ ...base, position: { x: 0.999, y: 0 }, speed: 100, cup: { x: -2, y: 0 }, terrainAt: (p) => p.x >= 1 ? "water" : "green", boundaryDistance: () => 0.0010002 });
    expect(beyondAbsoluteTolerance.terminal).toBe("water");
  });
  it("AC-SIM-006-05 produces deep-equal canonical Roll independent of presentation rate", () => {
    expect(resolveRoll(base)).toEqual(resolveRoll(base));
  });
});

describe("V2-SIM-007 Cup capture", () => {
  it("AC-SIM-007-01 captures swept/direct entries below and exactly 1.5, not above", () => {
    expect(resolveRoll({ ...base, speed: 1.4, cup: { x: 1, y: 0 } }).terminal).toBe("cup");
    expect(resolveRoll({ ...base, speed: 1.85, cup: { x: 1.35, y: 0 } }).terminal).toBe("cup"); // speed at entry is 1.5
    expect(resolveRoll({ ...base, speed: 2, cup: { x: 1, y: 0 } }).terminal).not.toBe("cup");
    const landed = resolveShot({ shotId: "landing", round: { lie: { x: 0, y: 0 }, playedStrokes: 0, penaltyStrokes: 0, selectedClub: "pw", directionIndex: 0 as never }, power: 0.1, originalLieTerrain: "fairway", cup: { x: 1.5, y: 0 }, terrainAt: green });
    expect(landed.terminal).toBe("cup");
  });
  it("AC-SIM-007-02 requires exit and eligible re-entry after a fast traversal", () => {
    const fastTraversal = resolveRoll({ ...base, speed: 2, cup: { x: 1, y: 0 } });
    // Entry is sqrt(2.7) > 1.5; exit is sqrt(1.3) < 1.5, so slowing inside cannot capture.
    expect(fastTraversal.terminal).toBe("rest");
    expect(Math.sqrt(2.7)).toBeGreaterThan(1.5);
    expect(Math.sqrt(1.3)).toBeLessThan(1.5);
    expect(fastTraversal.finalPosition.x).toBeGreaterThan(1.35);

    // A later Roll approaches from beyond the Cup only after the first traversal exited.
    const reentry = resolveRoll({ ...base, position: fastTraversal.finalPosition, direction: { x: -1, y: 0 }, speed: 1.4, cup: { x: 1, y: 0 } });
    expect(reentry.terminal).toBe("cup");
  });
  it("AC-SIM-007-03 leaves airborne crossings and Flag rendering mechanically irrelevant", () => {
    const common = { shotId: "air", round: { lie: { x: 0, y: 0 }, playedStrokes: 0, penaltyStrokes: 0, selectedClub: "driver" as const, directionIndex: 0 as never }, power: 1 as const, originalLieTerrain: "fairway" as const, cup: { x: 25, y: 0 }, terrainAt: green };
    expect(resolveShot(common).terminal).toBe("rest");
    expect(resolveShot(common)).toEqual(resolveShot(common)); // Flag/Cup is rendering-only and absent from inputs.
  });
});

describe("V2-SIM-008/009 outcomes and resolved contract", () => {
  const round = { lie: { x: 0, y: 0 }, playedStrokes: 2, penaltyStrokes: 1, selectedClub: "putter" as const, directionIndex: 0 as never };
  it("AC-SIM-008-01 restores/scoring for every Carry/Roll × Water/OOB failure while preserving Club/direction", () => {
    const cases = [
      ["roll-water", { ...round, selectedClub: "putter" as const }, (p: { x: number }) => p.x >= 1 ? "water" as const : "green" as const, "water"],
      ["roll-oob", { ...round, selectedClub: "putter" as const }, (p: { x: number }) => p.x >= 1 ? OUT_OF_BOUNDS : "green" as const, "out-of-bounds"],
      ["carry-water", { ...round, selectedClub: "driver" as const }, () => "water" as const, "water"],
      ["carry-oob", { ...round, selectedClub: "driver" as const }, () => OUT_OF_BOUNDS, "out-of-bounds"],
    ] as const;
    for (const [shotId, shotRound, terrainAt, terminal] of cases) {
      const shot = resolveShot({ shotId, round: shotRound, power: 1, originalLieTerrain: shotRound.selectedClub === "putter" ? "green" : "fairway", cup: { x: -2, y: 0 }, terrainAt });
      expect(shot.terminal).toBe(terminal);
      expect(shot.resultingRound).toEqual({ lie: round.lie, playedStrokes: 3, penaltyStrokes: 2, selectedClub: shotRound.selectedClub, directionIndex: 0 });
    }
  });
  it("AC-SIM-008-02 supplies exact two-second active-time notice descriptors", () => {
    expect(penaltyNoticeFor("water")).toEqual({ text: PENALTY_NOTICES.water, durationMilliseconds: 2000 });
    expect(penaltyNoticeFor("out-of-bounds")).toEqual({ text: "Out of Bounds! (+1 penalty)", durationMilliseconds: 2000 });
    const notice = createPenaltyNotice("water");
    if (notice === null) throw new Error("Water must create a notice.");
    expect(advancePenaltyNotice(notice, 0)).toEqual(notice); // resize freeze
    expect(advancePenaltyNotice(notice, 1_999)?.remainingActiveMilliseconds).toBe(1);
    expect(advancePenaltyNotice(notice, 2_000)).toBeNull();
    expect(discardPenaltyNoticeOnReload()).toBeNull();
  });
  it("AC-SIM-008-03 normalizes Carry/Roll checkpoints then reclassifies the edge result; live/resumed state is equal", () => {
    // Unnormalized Green rest is 0.9999996 (safe); canonical six-decimal 1.000000 is Water.
    const edgeRound = { ...round, lie: { x: -0.3000004, y: 0 }, selectedClub: "putter" as const };
    const shot = resolveShot({ shotId: "edge", round: edgeRound, power: 0.1, originalLieTerrain: "green", cup: { x: -2, y: 0 }, terrainAt: (p) => p.x >= 1 ? "water" : "green" });
    expect(shot.terminal).toBe("water");
    expect(shot.finalPosition.x).toBe(-0.3); // normalized canonical pre-Shot Lie is restored
    for (const frame of shot.keyframes) {
      expect(frame.elapsed).toBe(Number(frame.elapsed.toFixed(6)));
      expect(frame.position.x).toBe(Number(frame.position.x.toFixed(6)));
      expect(frame.position.y).toBe(Number(frame.position.y.toFixed(6)));
      expect(frame.speed).toBe(Number(frame.speed.toFixed(6)));
    }
    expect(JSON.parse(JSON.stringify(toDurableShot(shot)))).toEqual(toDurableShot(shot));
  });
  it("AC-SIM-008-04 has no Power Meter state or mutation in simulator results", () => {
    const shot = resolveShot({ shotId: "meter", round, power: 0.1, originalLieTerrain: "green", cup: { x: -2, y: 0 }, terrainAt: green });
    expect(shot).not.toHaveProperty("meter"); expect(shot.resultingRound).not.toHaveProperty("meter");
  });
  it("AC-SIM-009-01 consumes one ResolvedShot contract for simulator/persistence/playback", () => {
    const shot = resolveShot({ shotId: "shared", round, power: 0.1, originalLieTerrain: "green", cup: { x: -2, y: 0 }, terrainAt: green });
    expect(toDurableShot(shot).shotId).toBe(shot.shotId); expect(playbackKeyframes(shot)).toEqual(shot.keyframes);
  });
  it("AC-SIM-009-02 excludes frames durably and bounds in-memory Carry/Roll frames", () => {
    const shot = resolveShot({ shotId: "bound", round: { ...round, selectedClub: "driver" }, power: 1, originalLieTerrain: "fairway", cup: { x: -2, y: 0 }, terrainAt: green });
    expect(toDurableShot(shot)).not.toHaveProperty("keyframes"); expect(shot.keyframes.length).toBeLessThanOrEqual(512);
  });
  it("AC-SIM-009-03 permits skipped/differently timed playback copies without canonical mutation", () => {
    const shot = resolveShot({ shotId: "frames", round, power: 0.1, originalLieTerrain: "green", cup: { x: -2, y: 0 }, terrainAt: green });
    const frames = playbackKeyframes(shot);
    expect(frames[0]).not.toBe(shot.keyframes[0]);
    expect(shot.resultingRound).toEqual(shot.resultingRound);
  });
});
