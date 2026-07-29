import { describe, expect, it } from "vitest";

import {
  CLUB_LANDING_SPEED_RETENTION,
  CLUB_NOMINAL_DISTANCES,
  CLUB_ORDER,
  POWER_LEVELS,
  SHOT_DIRECTIONS,
  TERRAIN_CARRY_MULTIPLIERS,
  type Club,
  type PlayableTerrain,
  type Point,
} from "../domain/index.ts";
import { OUT_OF_BOUNDS, type RasterTerrain } from "../course-loader/index.ts";
import {
  carryProgress,
  carrySpeed,
  createPuttInitialState,
  isClubLegalOnTerrain,
  parseClub,
  parsePower,
  projectTarget,
  quantizeShotDirection,
  resolveCarry,
  selectAdjacentClub,
  selectAdjacentDirection,
  uninterruptedPuttDistance,
  vectorFromDiscreteDirection,
} from "./index.ts";

const direction = quantizeShotDirection(0);
const nearly = (actual: number, expected: number): void => {
  expect(actual).toBeCloseTo(expected, 12);
};

function pointNear(actual: Point, expected: Point): void {
  nearly(actual.x, expected.x);
  nearly(actual.y, expected.y);
}

describe("V2-SIM-001 shot inputs", () => {
  it("AC-SIM-001-01 table-drives all Club distances, order, and continuous wrapping", () => {
    const distances = [50, 44, 40, 35, 31, 27, 23, 19, 15, 13];
    for (const [index, club] of CLUB_ORDER.entries()) {
      expect(CLUB_NOMINAL_DISTANCES[club]).toBe(distances[index]);
      expect(selectAdjacentClub(club, 1)).toBe(CLUB_ORDER[(index + 1) % CLUB_ORDER.length]);
      expect(selectAdjacentClub(club, -1)).toBe(CLUB_ORDER[(index + CLUB_ORDER.length - 1) % CLUB_ORDER.length]);
    }
    expect(selectAdjacentClub("driver", -21)).toBe("putter");
    expect(selectAdjacentClub("putter", 21)).toBe("driver");
  });

  it("AC-SIM-001-02 orients, wraps, reconstructs all 16 vectors, and quantizes exact halfways clockwise", () => {
    for (const [index, bearing] of SHOT_DIRECTIONS.entries()) {
      const discrete = quantizeShotDirection(bearing);
      expect(discrete).toBe(index);
      const vector = vectorFromDiscreteDirection(discrete);
      nearly(Math.hypot(vector.x, vector.y), 1);
      nearly(Math.atan2(vector.y, vector.x) * 180 / Math.PI + (bearing > 180 ? 360 : 0), bearing);
      expect(selectAdjacentDirection(discrete, 16)).toBe(discrete);
    }
    pointNear(vectorFromDiscreteDirection(quantizeShotDirection(0)), { x: 1, y: 0 });
    pointNear(vectorFromDiscreteDirection(quantizeShotDirection(90)), { x: 0, y: 1 });
    expect(selectAdjacentDirection(quantizeShotDirection(0), -1)).toBe(15);
    expect(selectAdjacentDirection(quantizeShotDirection(337.5), 1)).toBe(0);
    expect(quantizeShotDirection(11.25)).toBe(1);
    expect(quantizeShotDirection(348.75)).toBe(0);
    expect(quantizeShotDirection(-11.25)).toBe(0);
    expect(quantizeShotDirection(371.25)).toBe(1);
  });

  it("AC-SIM-001-03 reconstructs a long displacement from direction, not a six-decimal stored vector", () => {
    const northeast = quantizeShotDirection(45);
    const carry = resolveCarry({
      lie: { x: 0, y: 0 }, lieTerrain: "fairway", club: "driver", power: 1,
      directionIndex: northeast, terrainAtLanding: () => "fairway",
    });
    const exact = Math.SQRT1_2 * 50;
    nearly(carry.landingPosition.x, exact);
    nearly(carry.landingPosition.y, exact);
    expect(carry.landingPosition.x).not.toBeCloseTo(0.707107 * 50, 12);
  });

  it("AC-SIM-001-04 accepts only ten exact Powers and every Club on every playable Terrain", () => {
    for (const power of POWER_LEVELS) expect(parsePower(power)).toBe(power);
    for (const rejected of [-0.1, 0, 0.11, 0.30000000000000004, 1.1, "1", null]) {
      expect(parsePower(rejected)).toBeUndefined();
    }
    for (const club of CLUB_ORDER) {
      expect(parseClub(club)).toBe(club);
      for (const terrain of ["fairway", "green", "rough", "bunker"] as const) {
        expect(isClubLegalOnTerrain(club, terrain)).toBe(true);
      }
    }
    expect(isClubLegalOnTerrain("driver", "water")).toBe(false);
    expect(parseClub("Driver")).toBeUndefined();
  });
});

describe("V2-SIM-002 shared Target projection", () => {
  it("AC-SIM-002-01 exposes one TargetProjection for preparation, path, camera, marker, distance, and OOB warning", () => {
    const projection = projectTarget({
      lie: { x: 1, y: 2 }, lieTerrain: "fairway", club: "driver", power: 1,
      directionIndex: direction, isInsideCourseBoundary: (point) => point.x <= 40,
    });
    const preparation = projection;
    const predictionPath = projection;
    const camera = projection;
    const marker = projection;
    const hudDistance = projection.distance;
    const warning = projection.isOutOfBounds;
    expect(preparation).toBe(predictionPath);
    expect(predictionPath).toBe(camera);
    expect(camera).toBe(marker);
    expect(hudDistance).toBe(50);
    expect(warning).toBe(true);
  });

  it("AC-SIM-002-02 keeps Fairway, Green, Rough, Bunker, Putter, and OOB Target consumers aligned", () => {
    const cases: readonly [PlayableTerrain, Club, number, boolean][] = [
      ["fairway", "driver", 50, false], ["green", "7i", 27, false],
      ["rough", "driver", 50, false], ["bunker", "pw", 15, false],
      ["green", "putter", 13, false], ["fairway", "putter", 26 / 6, false],
      ["rough", "putter", 26 / 6, false], ["bunker", "putter", 26 / 6, false],
      ["fairway", "driver", 50, true],
    ];
    for (const [lieTerrain, club, distance, oob] of cases) {
      const projection = projectTarget({
        lie: { x: 0, y: 0 }, lieTerrain, club, power: 1, directionIndex: direction,
        isInsideCourseBoundary: () => !oob,
      });
      expect(projection.distance).toBe(distance);
      expect(projection.position.x).toBe(distance);
      expect(projection.isOutOfBounds).toBe(oob);
    }
  });

  it("AC-SIM-002-03 labels Target as an expected projection rather than an actual-result guarantee", () => {
    const target = projectTarget({
      lie: { x: 0, y: 0 }, lieTerrain: "rough", club: "driver", power: 1,
      directionIndex: direction, isInsideCourseBoundary: () => true,
    });
    const carry = resolveCarry({
      lie: target.origin, lieTerrain: "rough", club: "driver", power: 1,
      directionIndex: direction, terrainAtLanding: () => "rough",
    });
    expect(target.distance).toBe(50);
    expect(carry.carryDistance).toBe(35);
    expect(carry.landingPosition.x).not.toBe(target.position.x);
  });
});

describe("V2-SIM-003 non-Putter Carry", () => {
  it("AC-SIM-003-01 golden-tests every non-Putter Club and Power at start, midpoint, grid checkpoint, and exact landing", () => {
    const clubs = CLUB_ORDER.filter((club): club is Exclude<Club, "putter"> => club !== "putter");
    for (const club of clubs) for (const power of POWER_LEVELS) {
      const retention = CLUB_LANDING_SPEED_RETENTION[club];
      if (retention === null) throw new Error("Non-Putter retention missing.");
      const carry = resolveCarry({
        lie: { x: 3, y: 4 }, lieTerrain: "fairway", club, power, directionIndex: direction,
        terrainAtLanding: () => "fairway",
      });
      const length = CLUB_NOMINAL_DISTANCES[club] * power;
      const duration = 3 * Math.sqrt(power);
      nearly(carry.carryDistance, length);
      nearly(carry.duration, duration);
      const start = carry.checkpoints[0];
      pointNear(start?.position ?? { x: NaN, y: NaN }, { x: 3, y: 4 });
      nearly(start?.speed ?? NaN, length / duration * (2 - retention));
      // Golden f(1/2) independently expands to (1-r)*3/4 + r/2.
      const midpointProgress = (1 - retention) * 0.75 + retention * 0.5;
      nearly(carryProgress(0.5, retention), midpointProgress);
      nearly(carrySpeed(length, duration, 0.5, retention), length / duration * (1 - retention + retention));
      const grid = carry.checkpoints[1];
      const u = (1 / 120) / duration;
      nearly(grid?.position.x ?? NaN, 3 + length * ((1 - retention) * (1 - (1 - u) ** 2) + retention * u));
      nearly(grid?.speed ?? NaN, length / duration * (2 * (1 - retention) * (1 - u) + retention));
      const landing = carry.checkpoints.at(-1);
      nearly(landing?.time ?? NaN, duration);
      pointNear(landing?.position ?? { x: NaN, y: NaN }, { x: 3 + length, y: 4 });
      nearly(landing?.speed ?? NaN, length / duration * retention);
    }
  });

  it("AC-SIM-003-02 applies exact Rough/Bunker Carry multipliers while Target retains Fairway projection", () => {
    for (const [terrain, multiplier] of Object.entries(TERRAIN_CARRY_MULTIPLIERS) as [PlayableTerrain, number][]) {
      const carry = resolveCarry({ lie: { x: 0, y: 0 }, lieTerrain: terrain, club: "driver", power: 1, directionIndex: direction, terrainAtLanding: () => "fairway" });
      nearly(carry.carryDistance, 50 * multiplier);
      const target = projectTarget({ lie: { x: 0, y: 0 }, lieTerrain: terrain, club: "driver", power: 1, directionIndex: direction, isInsideCourseBoundary: () => true });
      expect(target.distance).toBe(50);
    }
  });

  it("AC-SIM-003-03 ignores airborne Terrain/Water/Boundary/Cup crossings and evaluates only exact landing", () => {
    let calls = 0;
    const crossed: RasterTerrain[] = ["water", OUT_OF_BOUNDS, "green"];
    const carry = resolveCarry({
      lie: { x: 0, y: 0 }, lieTerrain: "fairway", club: "driver", power: 1, directionIndex: direction,
      terrainAtLanding: (point) => { calls += 1; expect(point.x).toBe(50); return crossed[2] ?? "green"; },
    });
    expect(calls).toBe(1);
    expect(carry.landingOutcome).toBe("roll");
    expect(carry.landingTerrain).toBe("green");
    expect(crossed).toContain("water");
    expect(crossed).toContain(OUT_OF_BOUNDS);
    for (const [landingTerrain, outcome] of [["water", "water"], [OUT_OF_BOUNDS, "out-of-bounds"]] as const) {
      const landed = resolveCarry({
        lie: { x: 0, y: 0 }, lieTerrain: "fairway", club: "driver", power: 1,
        directionIndex: direction, terrainAtLanding: () => landingTerrain,
      });
      expect(landed.landingOutcome).toBe(outcome);
    }
  });

  it("AC-SIM-003-04 retains final prior 1/120 grid checkpoint and exact unrounded T", () => {
    const carry = resolveCarry({ lie: { x: 0, y: 0 }, lieTerrain: "fairway", club: "driver", power: 0.2, directionIndex: direction, terrainAtLanding: () => "fairway" });
    const duration = 3 * Math.sqrt(0.2);
    const prior = Math.floor(duration * 120) / 120;
    const finalPrior = carry.checkpoints.at(-2);
    nearly(finalPrior?.time ?? NaN, prior);
    nearly(carry.checkpoints.at(-1)?.time ?? NaN, duration);
    expect(duration * 120).not.toBe(Math.floor(duration * 120));
  });
});

describe("V2-SIM-004 Putter", () => {
  it("AC-SIM-004-01 produces every specified initial speed and uninterrupted Green distance", () => {
    for (const power of POWER_LEVELS) {
      nearly(createPuttInitialState(power).initialSpeed, Math.sqrt(26 * power));
      nearly(uninterruptedPuttDistance(power, "green"), 13 * power);
    }
  });

  it("AC-SIM-004-02 has Fairway 26/6 and shorter Rough/Bunker actual results while Target displays Fairway projection", () => {
    const fairway = uninterruptedPuttDistance(1, "fairway");
    nearly(fairway, 26 / 6);
    expect(uninterruptedPuttDistance(1, "rough")).toBeLessThan(fairway);
    expect(uninterruptedPuttDistance(1, "bunker")).toBeLessThan(fairway);
    for (const terrain of ["rough", "bunker"] as const) {
      const target = projectTarget({ lie: { x: 0, y: 0 }, lieTerrain: terrain, club: "putter", power: 1, directionIndex: direction, isInsideCourseBoundary: () => true });
      nearly(target.distance, fairway);
    }
  });

  it("AC-SIM-004-03 never emits Carry checkpoints or an airborne Putter phase", () => {
    const putt = createPuttInitialState(1);
    expect(putt.phase).toBe("roll");
    expect(putt.carryCheckpoints).toEqual([]);
  });
});
