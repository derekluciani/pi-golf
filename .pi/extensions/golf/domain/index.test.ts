import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CLUB_LANDING_SPEED_RETENTION,
  CLUB_NOMINAL_DISTANCES,
  CLUB_ORDER,
  CUP,
  GREEN_DECELERATION_ORIGIN_MULTIPLIERS,
  NUMERIC_RULES,
  POWER_LEVELS,
  SHOT_DIRECTIONS,
  TERRAIN_CARRY_MULTIPLIERS,
  TERRAIN_ROLL_DECELERATION,
  TERRAINS,
  UI_STATES,
  type CourseHoleIndex,
  type HoleId,
  type HoleNumber,
  type PersistedRoundState,
  type TransientUiState,
} from "./index.ts";

describe("shared domain values", () => {
  it("defines the legal Club order and nominal distances", () => {
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
  });

  it("defines every landing-speed retention value", () => {
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
  });

  it("defines all Terrain mechanics", () => {
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
  });

  it("defines exactly ten legal Power levels", () => {
    expect(POWER_LEVELS).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });

  it("defines exactly sixteen legal Shot Directions", () => {
    expect(SHOT_DIRECTIONS).toEqual([
      0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5,
      180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5,
    ]);
  });

  it("defines Cup, frame-rate, epsilon, and normalization constants", () => {
    expect(CUP).toEqual({ captureRadius: 0.35, maximumCaptureSpeed: 1.5 });
    expect(NUMERIC_RULES).toMatchObject({
      comparisonEpsilon: 1e-6,
      normalizationDecimalPlaces: 6,
      physicsFramesPerSecond: 120,
      playbackFramesPerSecond: 30,
    });
  });
});

describe("state and identity boundaries", () => {
  it("keeps Hole number, ID, and Course array position type-distinct", () => {
    expectTypeOf<HoleNumber>().not.toEqualTypeOf<HoleId>();
    expectTypeOf<HoleNumber>().not.toEqualTypeOf<CourseHoleIndex>();
    expectTypeOf<HoleId>().not.toEqualTypeOf<CourseHoleIndex>();
  });

  it("keeps transient UI state out of persisted Round state", () => {
    expectTypeOf<PersistedRoundState>().not.toMatchTypeOf<TransientUiState>();
    expectTypeOf<TransientUiState>().not.toMatchTypeOf<PersistedRoundState>();
    expect(UI_STATES).toHaveLength(9);
  });
});
