import { describe, expect, expectTypeOf, it } from "vitest";

import {
  BASE_UI_STATES,
  CLUB_LANDING_SPEED_RETENTION,
  CLUB_NOMINAL_DISTANCES,
  CLUB_ORDER,
  CUP,
  GREEN_DECELERATION_CLUB_MULTIPLIERS,
  GREEN_DECELERATION_ORIGIN_MULTIPLIERS,
  NUMERIC_RULES,
  OVERLAY_RENDERING,
  PERSISTED_ROUND_STATE_KEYS,
  POWER_LEVELS,
  POWER_METER,
  PUTTER,
  SHOT_DIRECTIONS,
  TERRAIN_CARRY_MULTIPLIERS,
  TERRAIN_RENDERING,
  TERRAIN_ROLL_DECELERATION,
  TERRAINS,
  TIMING,
  UI_STATES,
  VIEWPORT,
  bearingForShotDirection,
  parseCourseHoleIndex,
  parseCourseId,
  parseHoleId,
  parseHoleNumber,
  parseShotDirectionIndex,
  type CourseHoleIndex,
  type HoleId,
  type HoleNumber,
  type PersistedRoundState,
  type ShotDirectionIndex,
  type TransientUiState,
} from "./index.ts";

describe("V2-FND-002 shared contracts", () => {
  it("AC-FND-002-01 defines one authoritative mechanical and rendering constant boundary", () => {
    expect(CLUB_ORDER).toEqual([
      "driver", "3i", "4i", "5i", "6i", "7i", "8i", "9i", "pw", "putter",
    ]);
    expect(CLUB_NOMINAL_DISTANCES).toEqual({
      driver: 50,
      "3i": 44,
      "4i": 40,
      "5i": 35,
      "6i": 31,
      "7i": 27,
      "8i": 23,
      "9i": 19,
      pw: 15,
      putter: 13,
    });
    expect(CLUB_LANDING_SPEED_RETENTION).toEqual({
      driver: 0.45,
      "3i": 0.39,
      "4i": 0.35,
      "5i": 0.31,
      "6i": 0.27,
      "7i": 0.23,
      "8i": 0.19,
      "9i": 0.15,
      pw: 0.08,
      putter: null,
    });
    expect(GREEN_DECELERATION_CLUB_MULTIPLIERS).toEqual({
      driver: 0.4,
      "3i": 0.7,
      "4i": 0.8,
      "5i": 0.9,
      "6i": 1,
      "7i": 1.1,
      "8i": 1.25,
      "9i": 1.4,
      pw: 1.6,
    });

    expect(TERRAINS).toEqual(["rough", "fairway", "green", "bunker", "water"]);
    expect(TERRAIN_CARRY_MULTIPLIERS).toEqual({
      fairway: 1,
      green: 1,
      rough: 0.7,
      bunker: 0.4,
    });
    expect(TERRAIN_ROLL_DECELERATION).toEqual({
      green: 1,
      fairway: 3,
      rough: 7,
      bunker: 18,
      water: null,
    });
    expect(GREEN_DECELERATION_ORIGIN_MULTIPLIERS).toEqual({
      fairway: 1.3,
      green: 1,
      rough: 0.8,
      bunker: 0.6,
    });

    expect(POWER_LEVELS).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(SHOT_DIRECTIONS).toEqual([
      0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5,
      180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5,
    ]);
    expect(CUP).toEqual({ captureRadius: 0.35, maximumCaptureSpeed: 1.5 });
    expect(PUTTER).toEqual({
      fullPowerGreenRollDistance: 13,
      fullPowerInitialSpeedSquared: 26,
      fullPowerFairwayRollDistance: 26 / 6,
    });
    expect(NUMERIC_RULES).toMatchObject({
      normalizationDecimalPlaces: 6,
      physicsFramesPerSecond: 120,
      playbackFramesPerSecond: 30,
      fullPowerCarryDurationSeconds: 3,
      rollEventTimeTieToleranceSeconds: 1e-9,
    });
    expect(POWER_METER).toEqual({ minimumBlocks: 1, maximumBlocks: 10, color: "#ed8796" });
    expect(TIMING).toEqual({
      introMilliseconds: 1_000,
      displayTimerMilliseconds: 2_000,
      targetPanDelayMilliseconds: 250,
      targetPanDurationMilliseconds: 1_000,
      powerMeterBinMilliseconds: 150,
      powerMeterFillMilliseconds: 1_500,
      powerMeterEmptyMilliseconds: 1_500,
    });
    expect(VIEWPORT).toMatchObject({
      nativeCourseWidth: 60,
      nativeCourseHeight: 60,
      columnsPerCourseUnit: 2,
      nativeTerminalWidth: 120,
      nativeTerminalHeight: 60,
      minimumTerminalWidth: 60,
      minimumTerminalHeight: 20,
    });
    expect(new Set(Object.keys(TERRAIN_RENDERING))).toEqual(new Set(TERRAINS));
    expect(OVERLAY_RENDERING).toHaveProperty("ball.glyph", "●");
    expect(OVERLAY_RENDERING).toHaveProperty("cup.glyph", "○");
  });

  it("AC-FND-002-02 prevents accidental Hole ID, number, and Course index substitution", () => {
    expectTypeOf<HoleNumber>().not.toEqualTypeOf<HoleId>();
    expectTypeOf<HoleNumber>().not.toEqualTypeOf<CourseHoleIndex>();
    expectTypeOf<HoleId>().not.toEqualTypeOf<CourseHoleIndex>();
    expectTypeOf<CourseHoleIndex>().not.toEqualTypeOf<ShotDirectionIndex>();
    expectTypeOf<PersistedRoundState["currentHoleIndex"]>().toEqualTypeOf<CourseHoleIndex>();

    expect(parseHoleId("hole-4")).toBe("hole-4");
    expect(parseHoleId(4)).toBeUndefined();
    expect(parseHoleNumber(4)).toBe(4);
    expect(parseHoleNumber("4")).toBeUndefined();
    expect(parseCourseHoleIndex(0)).toBe(0);
    expect(parseCourseHoleIndex(18)).toBeUndefined();
    expect(parseCourseId("preview-course")).toBe("preview-course");
    expect(parseShotDirectionIndex(15)).toBe(15);
    expect(parseShotDirectionIndex(16)).toBeUndefined();

    const direction = parseShotDirectionIndex(4);
    expect(direction).toBeDefined();
    if (direction !== undefined) expect(bearingForShotDirection(direction)).toBe(90);
  });

  it("AC-FND-002-03 excludes transient meter, notice, camera, and playback from persistence", () => {
    type ForbiddenPersistedKeys = Extract<
      keyof PersistedRoundState,
      "meter" | "notice" | "camera" | "playback"
    >;

    expectTypeOf<ForbiddenPersistedKeys>().toEqualTypeOf<never>();
    expectTypeOf<PersistedRoundState>().not.toMatchTypeOf<TransientUiState>();
    expectTypeOf<TransientUiState>().not.toMatchTypeOf<PersistedRoundState>();
    expect(PERSISTED_ROUND_STATE_KEYS).toEqual([
      "kind",
      "courseId",
      "currentHoleIndex",
      "lie",
      "selectedClub",
      "shotDirectionIndex",
      "holeScores",
      "status",
    ]);
    expect(PERSISTED_ROUND_STATE_KEYS).not.toEqual(
      expect.arrayContaining(["meter", "notice", "camera", "playback"]),
    );
    expect(BASE_UI_STATES).toEqual([
      "intro",
      "aiming",
      "metering",
      "committing",
      "playback",
      "penalty-notice",
      "hole-summary",
      "round-summary",
      "confirm-abandon",
    ]);
    expect(UI_STATES).toEqual([...BASE_UI_STATES, "resize-paused"]);
  });
});
