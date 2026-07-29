import {
  CLUB_LANDING_SPEED_RETENTION,
  CLUB_NOMINAL_DISTANCES,
  CUP,
  NUMERIC_RULES,
  TERRAIN_CARRY_MULTIPLIERS,
  type Club,
  type PlayableTerrain,
  type Point,
  type Power,
  type ShotDirectionIndex,
} from "../domain/index.ts";
import { OUT_OF_BOUNDS, type RasterTerrain } from "../course-loader/index.ts";
import { vectorFromDiscreteDirection } from "./inputs.ts";

export interface CarryInput {
  readonly lie: Point;
  readonly lieTerrain: PlayableTerrain;
  readonly club: Exclude<Club, "putter">;
  readonly power: Power;
  readonly directionIndex: ShotDirectionIndex;
  /** The authoritative Course Cup center. Its radius is always CUP.captureRadius. */
  readonly cup: Point;
  /** Called exactly once at the continuous Landing Position; crossings are ignored. */
  readonly terrainAtLanding: (point: Point) => RasterTerrain;
}

export interface CarryCheckpoint {
  readonly time: number;
  readonly position: Point;
  readonly speed: number;
}

export type CarryLandingOutcome = "roll" | "water" | "out-of-bounds" | "cup-entry";

/** The bounded result of testing only the exact Carry Landing Position against the Cup. */
export interface CarryCupEntry {
  readonly kind: "cup-entry";
  /** Capture is inclusive at the authoritative maximum speed. */
  readonly captureEligible: boolean;
}

export interface CarryTrajectory {
  readonly phase: "carry";
  readonly carryDistance: number;
  readonly duration: number;
  readonly landingPosition: Point;
  readonly landingSpeed: number;
  readonly landingTerrain: RasterTerrain;
  readonly landingOutcome: CarryLandingOutcome;
  /** Present only when the exact Landing Position enters the closed Cup disk. */
  readonly cupEntry: CarryCupEntry | null;
  readonly checkpoints: readonly CarryCheckpoint[];
}

/** PRD f(u), evaluated without checkpoint rounding. */
export function carryProgress(u: number, landingSpeedRetention: number): number {
  const clamped = Math.min(1, Math.max(0, u));
  return (1 - landingSpeedRetention) * (1 - (1 - clamped) ** 2)
    + landingSpeedRetention * clamped;
}

/** PRD v(u), evaluated without checkpoint rounding. */
export function carrySpeed(
  carryDistance: number,
  duration: number,
  u: number,
  landingSpeedRetention: number,
): number {
  const clamped = Math.min(1, Math.max(0, u));
  return (carryDistance / duration)
    * (2 * (1 - landingSpeedRetention) * (1 - clamped) + landingSpeedRetention);
}

/** Tests the PRD's closed Cup disk using its authoritative shared radius. */
export function isInsideClosedCupDisk(point: Point, cup: Point): boolean {
  const deltaX = point.x - cup.x;
  const deltaY = point.y - cup.y;
  return deltaX * deltaX + deltaY * deltaY <= CUP.captureRadius ** 2;
}

/** Resolves a non-putter airborne Carry up to, but not including, Roll. */
export function resolveCarry(input: CarryInput): CarryTrajectory {
  const retention = CLUB_LANDING_SPEED_RETENTION[input.club];
  if (retention === null) throw new RangeError("Putter has no Carry phase.");
  const carryDistance = CLUB_NOMINAL_DISTANCES[input.club] * input.power
    * TERRAIN_CARRY_MULTIPLIERS[input.lieTerrain];
  const duration = NUMERIC_RULES.fullPowerCarryDurationSeconds * Math.sqrt(input.power);
  const direction = vectorFromDiscreteDirection(input.directionIndex);
  const checkpointAt = (time: number): CarryCheckpoint => {
    const u = time / duration;
    const distance = carryDistance * carryProgress(u, retention);
    return {
      time,
      position: { x: input.lie.x + direction.x * distance, y: input.lie.y + direction.y * distance },
      speed: carrySpeed(carryDistance, duration, u, retention),
    };
  };

  const checkpoints: CarryCheckpoint[] = [checkpointAt(0)];
  const step = 1 / NUMERIC_RULES.physicsFramesPerSecond;
  for (let frame = 1; frame * step < duration; frame += 1) checkpoints.push(checkpointAt(frame * step));
  const landing = checkpointAt(duration);
  const landingTerrain = input.terrainAtLanding(landing.position);
  // OOB and Water take precedence before Carry hands the ball to Roll/Cup handling.
  const landingOutcome = landingTerrain === OUT_OF_BOUNDS
    ? "out-of-bounds"
    : landingTerrain === "water" ? "water"
    : isInsideClosedCupDisk(landing.position, input.cup) ? "cup-entry" : "roll";
  const cupEntry: CarryCupEntry | null = landingOutcome === "cup-entry"
    ? { kind: "cup-entry", captureEligible: landing.speed <= CUP.maximumCaptureSpeed }
    : null;
  return {
    phase: "carry",
    carryDistance,
    duration,
    landingPosition: landing.position,
    landingSpeed: landing.speed,
    landingTerrain,
    landingOutcome,
    cupEntry,
    checkpoints: [...checkpoints, landing],
  };
}
