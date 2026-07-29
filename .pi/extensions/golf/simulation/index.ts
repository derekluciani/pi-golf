export {
  bearingFromDiscreteDirection,
  bearingToward,
  isClubLegalOnTerrain,
  parseClub,
  parsePower,
  quantizeShotDirection,
  selectAdjacentClub,
  selectAdjacentDirection,
  vectorFromDiscreteDirection,
} from "./inputs.ts";
export { projectTarget, targetDistance, type TargetPathKind, type TargetProjection, type TargetProjectionInput } from "./projection.ts";
export {
  carryProgress,
  carrySpeed,
  isInsideClosedCupDisk,
  resolveCarry,
  type CarryCheckpoint,
  type CarryCupEntry,
  type CarryInput,
  type CarryLandingOutcome,
  type CarryTrajectory,
} from "./carry.ts";
export { createPuttInitialState, uninterruptedPuttDistance, type PuttInitialState } from "./putter.ts";
export { resolveRoll, rollDeceleration, type CourseBoundarySweep, type RollInput, type RollKeyframe, type RollTerminal, type RollTrajectory } from "./roll.ts";
export {
  PENALTY_NOTICES,
  advancePenaltyNotice,
  createPenaltyNotice,
  discardPenaltyNoticeOnReload,
  penaltyNoticeFor,
  playbackKeyframes,
  resolveShot,
  toDurableShot,
  type CompactRoundState,
  type PenaltyNoticeState,
  type DurableResolvedShot,
  type ResolvedShot,
  type ResolvedShotInput,
  type ShotTerminal,
} from "./outcome.ts";
