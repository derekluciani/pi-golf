import type { Point } from "../domain/index.ts";
import type { OffscreenArrow } from "./rendering-model.ts";
import type { HudInset } from "./viewport.ts";

export interface HudState { readonly visible: boolean; readonly inset: HudInset; }
export function toggleHud(state: HudState): HudState { return { ...state, visible: !state.visible }; }
/** Panel reservations expressed in Course Units/rows, kept inside the canvas. */
export function hudInset(state: HudState): HudInset { return state.visible ? state.inset : { top: 0, right: 0, bottom: 0, left: 0 }; }

export interface ScoringHud { readonly hole: number; readonly par: number; readonly holeScore: number; readonly roundScore: number; }
export interface ShotHud { readonly club: string; readonly lieTerrain: string; readonly shotDirection: string; readonly targetDistance: string; readonly oobTargetWarning: boolean; }
export interface HudPanels { readonly topLeft: readonly string[]; readonly topRight: readonly string[]; readonly bottomLeft: readonly string[]; readonly bottomRight: readonly string[]; }
export function createHudPanels(score: ScoringHud, shot: ShotHud, bottomLeft: readonly string[], bottomRight: readonly string[]): HudPanels {
  return { topLeft: [`Hole ${score.hole}`, `Par ${score.par}`, `Hole Score ${score.holeScore}`, `Round Score ${score.roundScore}`], topRight: [`Club ${shot.club}`, `Lie Terrain ${shot.lieTerrain}`, `Shot Direction ${shot.shotDirection}`, `Target ${shot.targetDistance}`, ...(shot.oobTargetWarning ? ["OOB Target"] : [])], bottomLeft, bottomRight };
}

/** Deterministic compass direction; y increases down terminal rows. */
export function offscreenArrow(point: Point, origin: Point, width: number, height: number): OffscreenArrow | undefined {
  const dx = point.x - origin.x; const dy = point.y - origin.y;
  if (dx >= 0 && dx < width && dy >= 0 && dy < height) return undefined;
  const horizontal = dx < 0 ? "left" : dx >= width ? "right" : undefined;
  const vertical = dy < 0 ? "up" : dy >= height ? "down" : undefined;
  return horizontal === undefined ? vertical : vertical === undefined ? horizontal : `${vertical}-${horizontal}` as OffscreenArrow;
}
