import {
  CLUB_ORDER,
  POWER_LEVELS,
  SHOT_DIRECTIONS,
  bearingForShotDirection,
  parseShotDirectionIndex,
  vectorForShotDirection,
  type Club,
  type PlayableTerrain,
  type Point,
  type Power,
  type ShotDirectionIndex,
} from "../domain/index.ts";

/** Validates an externally supplied Club without coercion. */
export function parseClub(value: unknown): Club | undefined {
  return typeof value === "string" && CLUB_ORDER.includes(value as Club) ? value as Club : undefined;
}

/** Validates one of the ten exact Power values without rounding or clamping. */
export function parsePower(value: unknown): Power | undefined {
  return typeof value === "number" && POWER_LEVELS.includes(value as Power) ? value as Power : undefined;
}

/** Every Club is legal from every playable Terrain. */
export function isClubLegalOnTerrain(club: unknown, terrain: unknown): club is Club {
  return parseClub(club) !== undefined
    && (terrain === "fairway" || terrain === "green" || terrain === "rough" || terrain === "bunker");
}

/** Selects the adjacent Club using the authoritative continuously wrapping order. */
export function selectAdjacentClub(club: Club, delta: number): Club {
  if (!Number.isInteger(delta)) throw new RangeError("Club selection delta must be an integer.");
  const current = CLUB_ORDER.indexOf(club);
  if (current < 0) throw new RangeError("Invalid Club.");
  const index = ((current + delta) % CLUB_ORDER.length + CLUB_ORDER.length) % CLUB_ORDER.length;
  const selected = CLUB_ORDER[index];
  if (selected === undefined) throw new RangeError("Invalid Club selection.");
  return selected;
}

/** Wraps a discrete direction index by whole 22.5° clockwise steps. */
export function selectAdjacentDirection(index: ShotDirectionIndex, delta: number): ShotDirectionIndex {
  if (!Number.isInteger(delta)) throw new RangeError("Shot Direction delta must be an integer.");
  const wrapped = ((index + delta) % SHOT_DIRECTIONS.length + SHOT_DIRECTIONS.length)
    % SHOT_DIRECTIONS.length;
  const parsed = parseShotDirectionIndex(wrapped);
  if (parsed === undefined) throw new RangeError("Invalid Shot Direction selection.");
  return parsed;
}

/**
 * Quantizes a continuous terminal-coordinate bearing to a discrete Direction.
 * Adding half a step before flooring deliberately chooses the clockwise index
 * at exact halfways, including the final-to-zero wrap.
 */
export function quantizeShotDirection(bearingDegrees: number): ShotDirectionIndex {
  if (!Number.isFinite(bearingDegrees)) throw new RangeError("Shot Direction bearing must be finite.");
  const normalized = ((bearingDegrees % 360) + 360) % 360;
  const index = Math.floor(normalized / 22.5 + 0.5) % SHOT_DIRECTIONS.length;
  const parsed = parseShotDirectionIndex(index);
  if (parsed === undefined) throw new RangeError("Invalid quantized Shot Direction.");
  return parsed;
}

/** Computes the terminal-coordinate bearing from one point to another. */
export function bearingToward(from: Point, to: Point): number {
  const bearing = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

/** Uses only the discrete index as the source of a physics vector. */
export function vectorFromDiscreteDirection(index: ShotDirectionIndex): Point {
  return vectorForShotDirection(index);
}

/** Re-exported for consumers needing the exact displayed bearing. */
export function bearingFromDiscreteDirection(index: ShotDirectionIndex): number {
  return bearingForShotDirection(index);
}

export type { PlayableTerrain };
