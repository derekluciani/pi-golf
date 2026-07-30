import type { TargetProjection } from "../simulation/index.ts";
import type { PlayableTerrain, Point, Terrain } from "../domain/index.ts";

/** A rendering-only marker; it never changes Course or simulation state. */
export type MarkerKind = "ball" | "cup" | "flag" | "target" | "path" | "boundary" | "offscreen-arrow";

export interface RenderMarker {
  readonly kind: MarkerKind;
  readonly point: Point;
  readonly arrow?: OffscreenArrow;
}

export type OffscreenArrow = "up" | "down" | "left" | "right" | "up-left" | "up-right" | "down-left" | "down-right";

export interface PredictionInput {
  readonly isAiming: boolean;
  /** The simulation's already-computed shared Target projection. */
  readonly target: TargetProjection;
  readonly path: readonly Point[];
}

/**
 * The Cup is mechanically active regardless of this display selection.  A Shot
 * keeps its origin terrain, so consumers select this once when the Shot begins.
 */
export function goalMarkerForShotOrigin(originTerrain: PlayableTerrain): "cup" | "flag" {
  return originTerrain === "green" ? "cup" : "flag";
}

/** Prediction is presentation-only and consumes, rather than recomputes, Target. */
export function predictionMarkers(input: PredictionInput): readonly RenderMarker[] {
  if (!input.isAiming) return [];
  return [
    ...input.path.map((point) => ({ kind: "path" as const, point })),
    { kind: "target" as const, point: input.target.position },
  ];
}

export type RenderTerrain = Terrain | "out-of-bounds";
