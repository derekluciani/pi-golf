import { TIMING, type Club, type PlayableTerrain, type Point, type Power, type ShotDirectionIndex } from "../domain/index.ts";
import { OUT_OF_BOUNDS, type RasterTerrain } from "../course-loader/index.ts";
import { resolveCarry, type CarryTrajectory } from "./carry.ts";
import { vectorFromDiscreteDirection } from "./inputs.ts";
import { createPuttInitialState } from "./putter.ts";
import { resolveRoll, type CourseBoundarySweep, type RollKeyframe, type RollTerminal } from "./roll.ts";

export type ShotTerminal = "rest" | "cup" | "water" | "out-of-bounds";

/** Compact state deliberately excludes all transient meter, notice, and playback data. */
export interface CompactRoundState {
  readonly lie: Point;
  readonly playedStrokes: number;
  readonly penaltyStrokes: number;
  readonly selectedClub: Club;
  readonly directionIndex: ShotDirectionIndex;
}

export interface ResolvedShotInput {
  readonly shotId: string;
  readonly round: CompactRoundState;
  readonly power: Power;
  readonly originalLieTerrain: PlayableTerrain;
  readonly cup: Point;
  readonly terrainAt: (point: Point) => RasterTerrain;
  /** Required exact bounded continuous Course-Boundary sweep for every Roll. */
  readonly courseBoundarySweep: CourseBoundarySweep;
}

export interface ResolvedShot {
  readonly shotId: string;
  readonly preShotLie: Point;
  readonly inputs: { readonly club: Club; readonly directionIndex: ShotDirectionIndex; readonly power: number };
  readonly landingPosition: Point;
  readonly finalPosition: Point;
  readonly terminal: ShotTerminal;
  readonly resultingSpeed: number;
  readonly elapsed: number;
  readonly resultingRound: CompactRoundState;
  /** In-memory only; serialize with `toDurableShot` to omit this field. */
  readonly keyframes: readonly RollKeyframe[];
}

export interface DurableResolvedShot {
  readonly shotId: string;
  readonly preShotLie: Point;
  readonly inputs: ResolvedShot["inputs"];
  readonly landingPosition: Point;
  readonly finalPosition: Point;
  readonly terminal: ShotTerminal;
  readonly resultingSpeed: number;
  readonly elapsed: number;
  readonly resultingRound: CompactRoundState;
}

export const MAX_PLAYBACK_KEYFRAMES = 512;

export const PENALTY_NOTICES = {
  water: "Water Hazard! (+1 penalty)",
  "out-of-bounds": "Out of Bounds! (+1 penalty)",
} as const;

/** The FSM owns active-time suspension; this pure descriptor supplies the one shared duration/text. */
export interface PenaltyNoticeState {
  readonly text: string;
  readonly remainingActiveMilliseconds: number;
}

export function penaltyNoticeFor(terminal: ShotTerminal): { readonly text: string; readonly durationMilliseconds: number } | null {
  if (terminal !== "water" && terminal !== "out-of-bounds") return null;
  return { text: PENALTY_NOTICES[terminal], durationMilliseconds: TIMING.displayTimerMilliseconds };
}

/** Pure active-time state: a resize contributes zero elapsed time; reload discards it. */
export function createPenaltyNotice(terminal: ShotTerminal): PenaltyNoticeState | null {
  const descriptor = penaltyNoticeFor(terminal);
  return descriptor === null ? null : { text: descriptor.text, remainingActiveMilliseconds: descriptor.durationMilliseconds };
}
export function advancePenaltyNotice(notice: PenaltyNoticeState, activeMilliseconds: number): PenaltyNoticeState | null {
  if (!Number.isFinite(activeMilliseconds) || activeMilliseconds < 0) throw new RangeError("Active notice time must be finite and non-negative.");
  const remainingActiveMilliseconds = Math.max(0, notice.remainingActiveMilliseconds - activeMilliseconds);
  return remainingActiveMilliseconds === 0 ? null : { ...notice, remainingActiveMilliseconds };
}
export function discardPenaltyNoticeOnReload(): null { return null; }

function normalized(value: number): number {
  return Number(value.toFixed(6));
}
function normalizedPoint(point: Point): Point {
  return { x: normalized(point.x), y: normalized(point.y) };
}
function normalizedKeyframe(keyframe: RollKeyframe): RollKeyframe {
  return {
    elapsed: normalized(keyframe.elapsed),
    position: normalizedPoint(keyframe.position),
    speed: normalized(keyframe.speed),
  };
}

/** Resolves Carry/Putt and Roll before any presentation consumer can observe the result. */
export function resolveShot(input: ResolvedShotInput): ResolvedShot {
  const direction = vectorFromDiscreteDirection(input.round.directionIndex);
  let terminal: RollTerminal;
  let landingPosition: Point;
  let finalPosition: Point;
  let speed: number;
  let elapsed: number;
  let keyframes: readonly RollKeyframe[];

  const rollInput = (position: Point, speed: number, club: Club) => ({
    position, speed, direction, club, originalLieTerrain: input.originalLieTerrain,
    cup: input.cup, terrainAt: input.terrainAt,
    courseBoundarySweep: input.courseBoundarySweep,
  });
  if (input.round.selectedClub === "putter") {
    const putt = createPuttInitialState(input.power);
    landingPosition = input.round.lie;
    const roll = resolveRoll(rollInput(input.round.lie, putt.initialSpeed, "putter"));
    terminal = roll.terminal;
    finalPosition = roll.finalPosition;
    speed = roll.resultingSpeed;
    elapsed = roll.elapsed;
    keyframes = roll.keyframes;
  } else {
    const carry: CarryTrajectory = resolveCarry({ lie: input.round.lie, lieTerrain: input.originalLieTerrain, club: input.round.selectedClub, power: input.power, directionIndex: input.round.directionIndex, cup: input.cup, terrainAtLanding: input.terrainAt });
    landingPosition = carry.landingPosition;
    if (carry.landingOutcome === "water" || carry.landingOutcome === "out-of-bounds") {
      terminal = carry.landingOutcome;
      finalPosition = input.round.lie;
      speed = 0;
      elapsed = carry.duration;
      keyframes = carry.checkpoints.map((checkpoint) => ({ elapsed: checkpoint.time, position: checkpoint.position, speed: checkpoint.speed }));
    } else {
      const roll = resolveRoll(rollInput(carry.landingPosition, carry.landingSpeed, input.round.selectedClub));
      terminal = roll.terminal;
      finalPosition = roll.finalPosition;
      speed = roll.resultingSpeed;
      elapsed = carry.duration + roll.elapsed;
      keyframes = [
        ...carry.checkpoints.map((checkpoint) => ({ elapsed: checkpoint.time, position: checkpoint.position, speed: checkpoint.speed })),
        ...roll.keyframes.slice(1).map((frame) => ({ ...frame, elapsed: carry.duration + frame.elapsed })),
      ];
    }
  }

  // Normalization is canonical: its position, not the pre-normalized trajectory,
  // is reclassified before the compact state is committed/persisted.
  const normalizedFinal = normalizedPoint(finalPosition);
  const normalizedTerminal = terminal === "rest" && input.terrainAt(normalizedFinal) === "water" ? "water"
    : terminal === "rest" && input.terrainAt(normalizedFinal) === OUT_OF_BOUNDS ? "out-of-bounds" : terminal;
  const failure = normalizedTerminal === "water" || normalizedTerminal === "out-of-bounds";
  const resultingRound: CompactRoundState = {
    lie: failure ? normalizedPoint(input.round.lie) : normalizedFinal,
    playedStrokes: input.round.playedStrokes + 1,
    penaltyStrokes: input.round.penaltyStrokes + (failure ? 1 : 0),
    selectedClub: input.round.selectedClub,
    directionIndex: input.round.directionIndex,
  };
  if (keyframes.length > MAX_PLAYBACK_KEYFRAMES) {
    keyframes = Array.from({ length: MAX_PLAYBACK_KEYFRAMES }, (_, index) => {
      const sourceIndex = Math.round(index * (keyframes.length - 1) / (MAX_PLAYBACK_KEYFRAMES - 1));
      const frame = keyframes[sourceIndex];
      if (frame === undefined) throw new RangeError("Missing playback keyframe.");
      return frame;
    });
  }
  // These are canonical simulation checkpoints, unlike renderer interpolation frames.
  keyframes = keyframes.map(normalizedKeyframe);
  return {
    shotId: input.shotId,
    preShotLie: normalizedPoint(input.round.lie),
    inputs: { club: input.round.selectedClub, directionIndex: input.round.directionIndex, power: input.power },
    landingPosition: normalizedPoint(landingPosition),
    finalPosition: resultingRound.lie,
    terminal: normalizedTerminal,
    resultingSpeed: normalized(speed),
    elapsed: normalized(elapsed),
    resultingRound,
    keyframes,
  };
}

/** Creates the durable T09 payload from the single simulation authority. */
export function toDurableShot(shot: ResolvedShot): DurableResolvedShot {
  return {
    shotId: shot.shotId, preShotLie: shot.preShotLie, inputs: shot.inputs,
    landingPosition: shot.landingPosition, finalPosition: shot.finalPosition,
    terminal: shot.terminal, resultingSpeed: shot.resultingSpeed, elapsed: shot.elapsed,
    resultingRound: shot.resultingRound,
  };
}

/** Presentation gets copies, so skipped/interpolated frames cannot mutate canonical state. */
export function playbackKeyframes(shot: ResolvedShot): readonly RollKeyframe[] {
  return shot.keyframes.map((frame) => ({ elapsed: frame.elapsed, position: { ...frame.position }, speed: frame.speed }));
}
