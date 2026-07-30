import { visibleWidth as piVisibleWidth } from "@earendil-works/pi-tui";

import { OVERLAY_RENDERING, TERRAIN_RENDERING, VIEWPORT } from "../domain/index.ts";
import type { RenderTerrain } from "./rendering-model.ts";
import type { MarkerKind, OffscreenArrow, RenderMarker } from "./rendering-model.ts";

const ESC = "\u001b[";
const RESET = `${ESC}0m`;

/**
 * Shared collision/rendering contract, in highest-to-lowest visible priority.
 * A single complete two-column tile is substituted for the winner; all losing
 * markers remain in their caller-owned mechanical state.  Ball and Target thus
 * remain visible even when their point is outside Course terrain.
 */
export const MARKER_RENDERING_CONTRACT = [
  "ball", "target", "cup", "flag", "offscreen-arrow", "boundary", "path",
] as const satisfies readonly MarkerKind[];

const markerPriority = new Map<MarkerKind, number>(
  MARKER_RENDERING_CONTRACT.map((kind, index) => [kind, index]),
);

const ARROWS: Readonly<Record<OffscreenArrow, string>> = {
  up: "↑", down: "↓", left: "←", right: "→",
  "up-left": "↖", "up-right": "↗", "down-left": "↙", "down-right": "↘",
};

function foreground(color: `#${string}`): string {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(color);
  if (match === null) throw new Error("Rendering color must be six-digit hexadecimal.");
  return `${ESC}38;2;${Number.parseInt(match[1] ?? "", 16)};${Number.parseInt(match[2] ?? "", 16)};${Number.parseInt(match[3] ?? "", 16)}m`;
}

function styled(text: string, color: `#${string}`): string {
  return `${foreground(color)}${text}${RESET}`;
}

/** Pi TUI's ANSI-aware width primitive, used for every layout decision here. */
export function visibleWidth(text: string): number {
  return piVisibleWidth(text);
}

/** Exactly one Course Unit: two columns, default background, and no style leak. */
export function renderTerrainTile(terrain: RenderTerrain): string {
  if (terrain === "out-of-bounds") return "  ";
  const spec = TERRAIN_RENDERING[terrain];
  return styled(spec.tile, spec.color);
}

/** A row always ends in reset, including an all-OOB row. */
export function renderTerrainRow(terrain: readonly RenderTerrain[]): string {
  return `${terrain.map(renderTerrainTile).join("")}${RESET}`;
}

export function markerGlyph(marker: RenderMarker): string {
  if (marker.kind === "offscreen-arrow") return ARROWS[marker.arrow ?? "up"];
  return marker.kind === "boundary" ? OVERLAY_RENDERING.courseBoundary.glyph : OVERLAY_RENDERING[marker.kind].glyph;
}

function markerColor(kind: MarkerKind): `#${string}` {
  if (kind === "boundary") return OVERLAY_RENDERING.courseBoundary.color;
  if (kind === "offscreen-arrow") return OVERLAY_RENDERING.offScreenArrow.color;
  return OVERLAY_RENDERING[kind].color;
}

/** Markers replace a complete Terrain tile and therefore always occupy two columns. */
export function renderMarkerTile(marker: RenderMarker): string {
  const tile = `${markerGlyph(marker)} `;
  if (visibleWidth(tile) !== VIEWPORT.columnsPerCourseUnit) throw new Error("Marker glyph must fit one Course Unit.");
  return styled(tile, markerColor(marker.kind));
}

/** Stable priority means input order cannot affect collision presentation. */
export function selectVisibleMarker(markers: readonly RenderMarker[]): RenderMarker | undefined {
  return markers.reduce<RenderMarker | undefined>((winner, marker) => {
    if (winner === undefined) return marker;
    const winnerPriority = markerPriority.get(winner.kind);
    const candidatePriority = markerPriority.get(marker.kind);
    if (winnerPriority === undefined || candidatePriority === undefined) throw new Error("Unknown marker kind.");
    return candidatePriority < winnerPriority ? marker : winner;
  }, undefined);
}

/** Crop source tiles before styling; width is rounded down to complete Course Units. */
export function cropTerrainTiles(terrain: readonly RenderTerrain[], maximumColumns: number): readonly RenderTerrain[] {
  if (!Number.isFinite(maximumColumns) || maximumColumns <= 0) return [];
  return terrain.slice(0, Math.floor(maximumColumns / VIEWPORT.columnsPerCourseUnit));
}

export function renderCroppedTerrainRow(terrain: readonly RenderTerrain[], maximumColumns: number): string {
  return renderTerrainRow(cropTerrainTiles(terrain, maximumColumns));
}
