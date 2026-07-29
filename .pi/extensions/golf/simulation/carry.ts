import {
  CLUB_LANDING_SPEED_RETENTION,
  CLUB_NOMINAL_DISTANCES,
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
  /** Called exactly once at the continuous Landing Position; crossings are ignored. */
  readonly terrainAtLanding: (point: Point) => RasterTerrain;
}

export interface CarryCheckpoint {
  readonly time: number;
  readonly position: Point;
  readonly speed: number;
}

export type CarryLandingOutcome = "roll" | "water" | "out-of-bounds";

export interface CarryTrajectory {
  readonly phase: "carry";
  readonly carryDistance: number;
  readonly duration: number;
  readonly landingPosition: Point;
  readonly landingSpeed: number;
  readonly landingTerrain: RasterTerrain;
  readonly landingOutcome: CarryLandingOutcome;
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
  return {
    phase: "carry",
    carryDistance,
    duration,
    landingPosition: landing.position,
    landingSpeed: landing.speed,
    landingTerrain,
    landingOutcome: landingTerrain === OUT_OF_BOUNDS
      ? "out-of-bounds"
      : landingTerrain === "water" ? "water" : "roll",
    checkpoints: [...checkpoints, landing],
  };
}
