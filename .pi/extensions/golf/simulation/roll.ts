import {
  CUP,
  GREEN_DECELERATION_CLUB_MULTIPLIERS,
  GREEN_DECELERATION_ORIGIN_MULTIPLIERS,
  NUMERIC_RULES,
  TERRAIN_ROLL_DECELERATION,
  type Club,
  type PlayableTerrain,
  type Point,
} from "../domain/index.ts";
import { OUT_OF_BOUNDS, type RasterTerrain } from "../course-loader/index.ts";

export type RollTerminal = "rest" | "cup" | "water" | "out-of-bounds";

export interface RollKeyframe {
  readonly elapsed: number;
  readonly position: Point;
  readonly speed: number;
}

/**
 * `terrainAt` is the T02 Boundary-first gameplay lookup. `boundaryDistance`, when
 * provided, supplies the exact continuous boundary crossing instead of relying on
 * a raster-cell transition. It is deliberately a pure dependency of Roll.
 */
export interface RollInput {
  readonly position: Point;
  readonly speed: number;
  readonly direction: Point;
  readonly club: Club;
  readonly originalLieTerrain: PlayableTerrain;
  readonly cup: Point;
  readonly terrainAt: (point: Point) => RasterTerrain;
  readonly boundaryDistance?: (from: Point, direction: Point, maximumDistance: number) => number | null;
}

export interface RollTrajectory {
  readonly phase: "roll";
  readonly initialPosition: Point;
  readonly landingPosition: Point;
  readonly finalPosition: Point;
  readonly finalTerrain: RasterTerrain;
  readonly resultingSpeed: number;
  readonly elapsed: number;
  readonly terminal: RollTerminal;
  readonly keyframes: readonly RollKeyframe[];
}

interface Candidate {
  readonly distance: number;
  readonly kind: "terrain" | "water" | "out-of-bounds" | "cup";
  readonly terrain?: RasterTerrain;
}

const MAX_KEYFRAMES = 512;
const PROBE = 1e-10;

/** Exact terrain deceleration, including the non-Putter Green modifier. */
export function rollDeceleration(
  terrain: PlayableTerrain,
  originalLieTerrain: PlayableTerrain,
  club: Club,
): number {
  if (terrain !== "green" || club === "putter") {
    const base = TERRAIN_ROLL_DECELERATION[terrain];
    if (base === null) throw new RangeError("Water has no Roll deceleration.");
    return base;
  }
  return GREEN_DECELERATION_ORIGIN_MULTIPLIERS[originalLieTerrain]
    * GREEN_DECELERATION_CLUB_MULTIPLIERS[club];
}

function pointAt(origin: Point, direction: Point, distance: number): Point {
  return { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
}

function timeForDistance(speed: number, deceleration: number, distance: number): number {
  // v*t - 1/2*a*t² = distance; the smaller root is the forward physical time.
  const discriminant = speed * speed - 2 * deceleration * distance;
  return (speed - Math.sqrt(Math.max(0, discriminant))) / deceleration;
}

function cupEntryDistance(position: Point, direction: Point, cup: Point, maximum: number): number | null {
  const x = position.x - cup.x;
  const y = position.y - cup.y;
  const projection = -(x * direction.x + y * direction.y);
  const perpendicularSquared = x * x + y * y - projection * projection;
  const radiusSquared = CUP.captureRadius ** 2;
  if (perpendicularSquared > radiusSquared) return null;
  const offset = Math.sqrt(Math.max(0, radiusSquared - perpendicularSquared));
  const entry = projection - offset;
  return entry >= 0 && entry <= maximum ? entry : null;
}

/** Distance to the next raster-cell edge in the direction of travel. */
function nextCellDistance(position: Point, direction: Point): number {
  const distances: number[] = [];
  if (direction.x > 0) distances.push((Math.floor(position.x) + 1 - position.x) / direction.x);
  if (direction.x < 0) distances.push((position.x - Math.floor(position.x)) / -direction.x || 1 / -direction.x);
  if (direction.y > 0) distances.push((Math.floor(position.y) + 1 - position.y) / direction.y);
  if (direction.y < 0) distances.push((position.y - Math.floor(position.y)) / -direction.y || 1 / -direction.y);
  const distance = Math.min(...distances.filter((value) => value > 0));
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

function canonicalKeyframes(keyframes: readonly RollKeyframe[]): readonly RollKeyframe[] {
  if (keyframes.length <= MAX_KEYFRAMES) return keyframes;
  const first = keyframes[0];
  const last = keyframes.at(-1);
  if (first === undefined || last === undefined) return [];
  const result: RollKeyframe[] = [first];
  for (let index = 1; index < MAX_KEYFRAMES - 1; index += 1) {
    const frame = keyframes[Math.round(index * (keyframes.length - 1) / (MAX_KEYFRAMES - 1))];
    if (frame !== undefined) result.push(frame);
  }
  result.push(last);
  return result;
}

/**
 * Resolves Roll using analytical kinematics. Outer 1/120-second boundaries only
 * bound work; every terrain/cup/hazard event splits an outer step exactly and the
 * remainder is immediately integrated under the newly selected terrain.
 */
export function resolveRoll(input: RollInput): RollTrajectory {
  const unitLength = Math.hypot(input.direction.x, input.direction.y);
  if (!Number.isFinite(input.speed) || input.speed < 0 || unitLength === 0 || !Number.isFinite(unitLength)) {
    throw new RangeError("Roll requires a finite non-negative speed and non-zero direction.");
  }
  const direction = { x: input.direction.x / unitLength, y: input.direction.y / unitLength };
  let position = { ...input.position };
  let speed = input.speed;
  let elapsed = 0;
  let terrain = input.terrainAt(position);
  let terminal: RollTerminal = "rest";
  let insideCup = false;
  const keyframes: RollKeyframe[] = [{ elapsed, position: { ...position }, speed }];
  const frameDuration = 1 / NUMERIC_RULES.physicsFramesPerSecond;

  if (terrain === OUT_OF_BOUNDS || terrain === "water") {
    terminal = terrain === "water" ? "water" : "out-of-bounds";
  } else if (isInsideCup(position, input.cup)) {
    // Landing inside the closed disk is an entry evaluated immediately at landing speed.
    insideCup = true;
    if (speed <= CUP.maximumCaptureSpeed) terminal = "cup";
  }

  while (terminal === "rest" && speed > 0) {
    let remaining = frameDuration;
    while (remaining > 0 && terminal === "rest" && speed > 0) {
      if (terrain === OUT_OF_BOUNDS || terrain === "water") {
        terminal = terrain === "water" ? "water" : "out-of-bounds";
        break;
      }
      const deceleration = rollDeceleration(terrain, input.originalLieTerrain, input.club);
      const restTime = speed / deceleration;
      const localTime = Math.min(remaining, restTime);
      const maximumDistance = speed * localTime - 0.5 * deceleration * localTime * localTime;
      const candidates: Candidate[] = [];
      const cellDistance = nextCellDistance(position, direction);
      if (cellDistance <= maximumDistance) {
        const after = pointAt(position, direction, cellDistance + PROBE);
        const nextTerrain = input.terrainAt(after);
        if (nextTerrain !== terrain) candidates.push({
          distance: cellDistance,
          kind: nextTerrain === OUT_OF_BOUNDS ? "out-of-bounds" : nextTerrain === "water" ? "water" : "terrain",
          terrain: nextTerrain,
        });
      }
      const boundaryDistance = input.boundaryDistance?.(position, direction, maximumDistance) ?? null;
      if (boundaryDistance !== null && boundaryDistance >= 0 && boundaryDistance <= maximumDistance) {
        candidates.push({ distance: boundaryDistance, kind: "out-of-bounds" });
      }
      if (!insideCup) {
        const entry = cupEntryDistance(position, direction, input.cup, maximumDistance);
        if (entry !== null) candidates.push({ distance: entry, kind: "cup" });
      }

      const earliest = candidates.reduce<Candidate | null>((best, candidate) => {
        if (best === null || candidate.distance < best.distance - NUMERIC_RULES.rollEventTimeTieToleranceSeconds * Math.max(speed, 1)) return candidate;
        if (Math.abs(candidate.distance - best.distance) <= NUMERIC_RULES.rollEventTimeTieToleranceSeconds * Math.max(speed, 1)) {
          const precedence = { "out-of-bounds": 4, water: 3, cup: 2, terrain: 1 } as const;
          return precedence[candidate.kind] > precedence[best.kind] ? candidate : best;
        }
        return best;
      }, null);

      if (earliest === null) {
        position = pointAt(position, direction, maximumDistance);
        speed -= deceleration * localTime;
        elapsed += localTime;
        remaining -= localTime;
        if (localTime === restTime) speed = 0;
        // A completed traversal that is no longer inside permits a later re-entry.
        if (insideCup && !isInsideCup(position, input.cup)) insideCup = false;
      } else {
        const eventTime = timeForDistance(speed, deceleration, earliest.distance);
        position = pointAt(position, direction, earliest.distance);
        speed -= deceleration * eventTime;
        elapsed += eventTime;
        remaining -= eventTime;
        if (earliest.kind === "out-of-bounds") terminal = "out-of-bounds";
        else if (earliest.kind === "water") terminal = "water";
        else if (earliest.kind === "cup") {
          insideCup = true;
          if (speed <= CUP.maximumCaptureSpeed) terminal = "cup";
          else {
            // Move an infinitesimal distance into the disk so this entry cannot be retried.
            position = pointAt(position, direction, PROBE);
          }
        } else if (earliest.terrain !== undefined) terrain = earliest.terrain;
      }
    }
    keyframes.push({ elapsed, position: { ...position }, speed: Math.max(0, speed) });
  }

  return {
    phase: "roll",
    initialPosition: { ...input.position },
    landingPosition: { ...input.position },
    finalPosition: position,
    finalTerrain: terminal === "out-of-bounds" ? OUT_OF_BOUNDS : terminal === "water" ? "water" : input.terrainAt(position),
    resultingSpeed: Math.max(0, speed),
    elapsed,
    terminal,
    keyframes: canonicalKeyframes(keyframes),
  };
}

function isInsideCup(point: Point, cup: Point): boolean {
  const x = point.x - cup.x;
  const y = point.y - cup.y;
  return x * x + y * y <= CUP.captureRadius ** 2;
}
