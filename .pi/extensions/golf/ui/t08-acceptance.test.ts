import { describe, expect, it } from "vitest";

import { ManualMonotonicClock } from "../domain/index.ts";
import { CameraController, ResolvedShotPlayback, allocateViewport, createHudPanels, hudInset, hudSafePoint, offscreenArrow, smoothstep, toggleHud } from "./index.ts";

describe("V2-T08 responsive viewport, camera, and playback", () => {
  it("AC-REN-003-02 allocates the exact responsive matrix and clamps native/oversized canvases", () => {
    for (const width of [59, 60, 61, 119, 120]) for (const height of [19, 20, 21, 59, 60]) {
      const allocation = allocateViewport(width, height);
      expect(allocation.courseUnitsWide).toBe(Math.floor(width / 2));
      expect(allocation.courseUnitsHigh).toBe(height);
      expect(allocation.suspended).toBe(width < 60 || height < 20);
    }
    expect(allocateViewport(80, 35)).toMatchObject({ columns: 80, rows: 35, courseUnitsWide: 40 });
    expect(allocateViewport(120, 60)).toMatchObject({ columns: 120, rows: 60, courseUnitsWide: 60 });
    expect(allocateViewport(240, 100)).toMatchObject({ columns: 120, rows: 60, courseUnitsWide: 60 });
  });

  it("AC-REN-003-03 leaves odd columns unused and HUD safe points never add geometry or overflow", () => {
    for (const width of [1, 59, 61, 119]) expect(allocateViewport(width, 60).columns - allocateViewport(width, 60).courseUnitsWide * 2).toBe(width % 2);
    const viewport = allocateViewport(60, 20);
    const safe = hudSafePoint({ x: 99, y: -4 }, viewport, { top: 2, right: 4, bottom: 3, left: 5 });
    expect(safe).toEqual({ x: 25, y: 2 });
    expect(viewport).toMatchObject({ columns: 60, rows: 20 });
  });

  it("AC-REN-005-01 uses exact active-time target delay, smoothstep pan, direct playback, recenter and resize freeze/resume", () => {
    const clock = new ManualMonotonicClock(); const camera = new CameraController(clock, { x: 0, y: 0 }, { x: 10, y: 20 });
    clock.advanceBy(250); expect(camera.position()).toEqual({ x: 0, y: 0 });
    clock.advanceBy(500); expect(camera.position()).toEqual({ x: 5, y: 10 }); expect(smoothstep(0.5)).toBe(0.5);
    clock.advanceBy(500); expect(camera.position()).toEqual({ x: 10, y: 20 });
    camera.followBall({ x: 7, y: 8 }); expect(camera.position()).toEqual({ x: 7, y: 8 });
    camera.recenter({ x: 2, y: 3 }); expect(camera.position()).toEqual({ x: 2, y: 3 });
    clock.advanceBy(100); camera.freezeForResize(); clock.advanceBy(9_000); expect(camera.position()).toEqual({ x: 2, y: 3 });
    camera.resumeFromResize(); clock.advanceBy(150); expect(camera.position()).toEqual({ x: 2, y: 3 }); clock.advanceBy(500); expect(camera.position().x).toBe(6);
  });

  it("AC-REN-005-02 cancels delayed pans on Tab and club/direction changes without stale timer overrides", () => {
    const clock = new ManualMonotonicClock(); const camera = new CameraController(clock, { x: 0, y: 0 }, { x: 10, y: 0 });
    clock.advanceBy(200); camera.tab(); expect(camera.position()).toEqual({ x: 10, y: 0 });
    clock.advanceBy(10_000); expect(camera.position()).toEqual({ x: 10, y: 0 });
    camera.changedAim({ x: 2, y: 2 }, { x: 20, y: 2 }); clock.advanceBy(249); expect(camera.position()).toEqual({ x: 2, y: 2 });
    camera.followBall({ x: 9, y: 9 }); clock.advanceBy(10_000); expect(camera.position()).toEqual({ x: 9, y: 9 });
  });

  it("AC-REN-005-03 uses official scoring HUD terms in corners, toggles all panels, and exposes its safe inset", () => {
    const panels = createHudPanels({ hole: 1, par: 4, holeScore: 2, roundScore: 7 }, { club: "driver", lieTerrain: "fairway", shotDirection: "0°", targetDistance: "50", oobTargetWarning: true }, ["Controls"], ["Power Meter"]);
    expect(panels.topLeft).toEqual(["Hole 1", "Par 4", "Hole Score 2", "Round Score 7"]); expect(panels.topRight.at(-1)).toBe("OOB Target");
    const hidden = toggleHud({ visible: true, inset: { top: 3, right: 4, bottom: 2, left: 1 } }); expect(hidden.visible).toBe(false); expect(hudInset(hidden)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("AC-REN-005-04 chooses deterministic off-screen arrows at viewport edges", () => {
    const origin = { x: 0, y: 0 }; expect(offscreenArrow({ x: 0, y: 0 }, origin, 20, 20)).toBeUndefined();
    expect(offscreenArrow({ x: -1, y: -1 }, origin, 20, 20)).toBe("up-left"); expect(offscreenArrow({ x: 20, y: 20 }, origin, 20, 20)).toBe("down-right");
    expect(offscreenArrow({ x: -1, y: 10 }, origin, 20, 20)).toBe("left"); expect(offscreenArrow({ x: 10, y: 20 }, origin, 20, 20)).toBe("down");
  });

  it("AC-REN-006-01 converges skipped and regular 30 FPS presentation schedules on the same immutable resolved outcome", () => {
    const resolved = { shotId: "shot-1", keyframes: [{ atMilliseconds: 0, position: { x: 0, y: 0 }, speed: 10 }, { atMilliseconds: 1_000, position: { x: 10, y: 0 }, speed: 0 }], terminal: "rest" } as const;
    const aClock = new ManualMonotonicClock(); const bClock = new ManualMonotonicClock(); const a = new ResolvedShotPlayback(aClock, resolved); const b = new ResolvedShotPlayback(bClock, resolved); a.start(); b.start();
    for (let time = 0; time < 1_000; time += 33) { aClock.advanceTo(time); a.frame(); } bClock.advanceTo(1_000);
    aClock.advanceTo(1_000); expect(a.frame()).toEqual(b.frame()); expect(resolved).toEqual({ shotId: "shot-1", keyframes: [{ atMilliseconds: 0, position: { x: 0, y: 0 }, speed: 10 }, { atMilliseconds: 1_000, position: { x: 10, y: 0 }, speed: 0 }], terminal: "rest" });
  });

  it("AC-REN-006-02 retains no Round or persistence capability and cannot mutate resolved keyframes", () => {
    const clock = new ManualMonotonicClock(); const resolved = Object.freeze({ shotId: "shot-2", keyframes: Object.freeze([{ atMilliseconds: 0, position: Object.freeze({ x: 1, y: 1 }), speed: 1 }]), terminal: "rest" as const });
    const playback = new ResolvedShotPlayback(clock, resolved); playback.start(); const frame = playback.frame(); const keyframe = resolved.keyframes[0]; if (keyframe === undefined) throw new Error("fixture keyframe missing"); expect(frame.position).toEqual({ x: 1, y: 1 }); expect(frame.position).not.toBe(keyframe.position);
  });

  it("AC-UI-003-02 freezes concrete ResolvedShotPlayback active time during resize", () => {
    const clock = new ManualMonotonicClock(); const playback = new ResolvedShotPlayback(clock, { shotId: "freeze", keyframes: [{ atMilliseconds: 0, position: { x: 0, y: 0 }, speed: 1 }, { atMilliseconds: 100, position: { x: 1, y: 0 }, speed: 0 }], terminal: "rest" });
    playback.start(); clock.advanceBy(50); playback.freezeForResize(); clock.advanceBy(10_000); expect(playback.frame().complete).toBe(false); playback.resumeFromResize(); clock.advanceBy(49); expect(playback.frame().complete).toBe(false); clock.advanceBy(1); expect(playback.frame().complete).toBe(true);
  });

  it("AC-REN-006-03 delays completion and hazard text until their terminal playback frame", () => {
    for (const [terminal, notice] of [["cup", "Hole complete"], ["water", "Water hazard"], ["out-of-bounds", "Out of Bounds"]] as const) {
      const clock = new ManualMonotonicClock(); const playback = new ResolvedShotPlayback(clock, { shotId: terminal, keyframes: [{ atMilliseconds: 0, position: { x: 0, y: 0 }, speed: 1 }, { atMilliseconds: 100, position: { x: 1, y: 1 }, speed: 0 }], terminal }); playback.start(); clock.advanceBy(99); expect(playback.frame().notice).toBeUndefined(); clock.advanceBy(1); expect(playback.frame().notice).toBe(notice);
    }
  });
});
