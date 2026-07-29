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
