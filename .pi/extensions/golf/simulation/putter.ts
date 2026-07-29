import {
  PUTTER,
  TERRAIN_ROLL_DECELERATION,
  type PlayableTerrain,
  type Power,
} from "../domain/index.ts";

/** Initial Putt state; it deliberately has no airborne phase or Carry checkpoints. */
export interface PuttInitialState {
  readonly phase: "roll";
  readonly initialSpeed: number;
  readonly carryCheckpoints: readonly [];
}

/** Calculates the Putter's PRD initial speed from committed Power. */
export function createPuttInitialState(power: Power): PuttInitialState {
  return {
    phase: "roll",
    initialSpeed: Math.sqrt(PUTTER.fullPowerInitialSpeedSquared * power),
    carryCheckpoints: [],
  };
}

/** Closed-form uninterrupted Putt distance on a constant playable Terrain. */
export function uninterruptedPuttDistance(power: Power, terrain: PlayableTerrain): number {
  const deceleration = TERRAIN_ROLL_DECELERATION[terrain];
  if (deceleration === null) throw new RangeError("Putt Terrain must be playable.");
  const initialSpeed = createPuttInitialState(power).initialSpeed;
  return initialSpeed ** 2 / (2 * deceleration);
}
