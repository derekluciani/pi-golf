import {
  CLUB_NOMINAL_DISTANCES,
  PUTTER,
  type Club,
  type PlayableTerrain,
  type Point,
  type Power,
  type ShotDirectionIndex,
} from "../domain/index.ts";
import { vectorFromDiscreteDirection } from "./inputs.ts";

export type TargetPathKind = "carry" | "putt-roll";

/** Single shared expected Target result for simulation and presentation consumers. */
export interface TargetProjection {
  readonly kind: "target-projection";
  readonly pathKind: TargetPathKind;
  readonly origin: Point;
  readonly directionIndex: ShotDirectionIndex;
  readonly power: Power;
  readonly distance: number;
  readonly position: Point;
  readonly isOutOfBounds: boolean;
}

export interface TargetProjectionInput {
  readonly lie: Point;
  readonly lieTerrain: PlayableTerrain;
  readonly club: Club;
  readonly power: Power;
  readonly directionIndex: ShotDirectionIndex;
  /** Boundary-first Course lookup supplied by the Course/simulation integration. */
  readonly isInsideCourseBoundary: (point: Point) => boolean;
}

/**
 * Produces the one expected Target. It intentionally does not model Terrain
 * transitions or hidden Rough/Bunker penalties, so it is never an outcome guarantee.
 */
export function projectTarget(input: TargetProjectionInput): TargetProjection {
  const distance = targetDistance(input.club, input.lieTerrain, input.power);
  const vector = vectorFromDiscreteDirection(input.directionIndex);
  const position = {
    x: input.lie.x + vector.x * distance,
    y: input.lie.y + vector.y * distance,
  };
  return {
    kind: "target-projection",
    pathKind: input.club === "putter" ? "putt-roll" : "carry",
    origin: input.lie,
    directionIndex: input.directionIndex,
    power: input.power,
    distance,
    position,
    isOutOfBounds: !input.isInsideCourseBoundary(position),
  };
}

/** Target distance intentionally uses Fairway expectations where the PRD hides penalties. */
export function targetDistance(club: Club, lieTerrain: PlayableTerrain, power: Power): number {
  if (club !== "putter") return CLUB_NOMINAL_DISTANCES[club] * power;
  if (lieTerrain === "green") return PUTTER.fullPowerGreenRollDistance * power;
  return PUTTER.fullPowerFairwayRollDistance * power;
}
