import { describe, expect, it } from "vitest";

import { OVERLAY_RENDERING, TERRAIN_RENDERING, VIEWPORT, parseShotDirectionIndex } from "../domain/index.ts";
import { projectTarget } from "../simulation/index.ts";
import { goalMarkerForShotOrigin, predictionMarkers, type MarkerKind, type RenderMarker } from "./rendering-model.ts";
import { MARKER_RENDERING_CONTRACT, cropTerrainTiles, markerGlyph, renderCroppedTerrainRow, renderMarkerTile, renderTerrainRow, renderTerrainTile, selectVisibleMarker, visibleWidth } from "./primitives.ts";

const reset = "\u001b[0m";
const point = { x: 1, y: 1 };
const marker = (kind: MarkerKind): RenderMarker => ({ kind, point });

describe("V2-REN rendering primitives", () => {
  it("AC-REN-001-01 snapshots exact two-column Terrain glyphs, direct colors, default background, and row reset", () => {
    for (const terrain of Object.keys(TERRAIN_RENDERING) as (keyof typeof TERRAIN_RENDERING)[]) {
      const spec = TERRAIN_RENDERING[terrain];
      const tile = renderTerrainTile(terrain);
      expect(tile).toBe(`\u001b[38;2;${Number.parseInt(spec.color.slice(1, 3), 16)};${Number.parseInt(spec.color.slice(3, 5), 16)};${Number.parseInt(spec.color.slice(5, 7), 16)}m${spec.tile}${reset}`);
      expect(visibleWidth(tile)).toBe(VIEWPORT.columnsPerCourseUnit);
      expect(tile).not.toContain("48;");
    }
    expect(renderTerrainRow(["green"])).toBe(`${renderTerrainTile("green")}${reset}`);
  });

  it("AC-REN-001-02 snapshots exact unstyled OOB tiles and reset Boundary transitions", () => {
    expect(renderTerrainTile("out-of-bounds")).toBe("  ");
    const row = renderTerrainRow(["green", "out-of-bounds", "water", "out-of-bounds"]);
    expect(row).toBe(`${renderTerrainTile("green")}  ${renderTerrainTile("water") }  ${reset}`);
    expect(visibleWidth(row)).toBe(8);
  });

  it("AC-REN-001-03 distinguishes every Terrain solely by its fixed pattern", () => {
    const patterns = Object.values(TERRAIN_RENDERING).map(({ tile }) => tile);
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(patterns).toEqual(["⠁⠈", "⠒⠒", "⣶⣶", "⠶⠶", "⠛⣤"]);
  });

  it("AC-REN-002-01 snapshots marker glyph/color, Flag/Cup origin switching, and active hidden Cup", () => {
    expect(goalMarkerForShotOrigin("fairway")).toBe("flag");
    expect(goalMarkerForShotOrigin("green")).toBe("cup");
    expect(goalMarkerForShotOrigin("rough")).toBe("flag");
    // The Cup marker still exists mechanically while Flag is the selected display.
    const hiddenCup = marker("cup");
    expect(hiddenCup.kind).toBe("cup");
    for (const kind of MARKER_RENDERING_CONTRACT) {
      const rendered = renderMarkerTile(marker(kind));
      const color = kind === "boundary" ? OVERLAY_RENDERING.courseBoundary.color : kind === "offscreen-arrow" ? OVERLAY_RENDERING.offScreenArrow.color : OVERLAY_RENDERING[kind].color;
      const rgb = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((part) => Number.parseInt(part, 16));
      expect(rendered).toBe(`\u001b[38;2;${rgb.join(";")}m${markerGlyph(marker(kind))} ${reset}`);
      expect(visibleWidth(rendered)).toBe(2);
    }
    expect(["up", "down", "left", "right", "up-left", "up-right", "down-left", "down-right"].map((arrow) => markerGlyph({ ...marker("offscreen-arrow"), arrow: arrow as "up" | "down" | "left" | "right" | "up-left" | "up-right" | "down-left" | "down-right" }))).toEqual(["↑", "↓", "←", "→", "↖", "↗", "↙", "↘"]);
  });

  it("AC-REN-002-02 renders prediction only while aiming from the shared simulation Target projection", () => {
    const directionIndex = parseShotDirectionIndex(0);
    if (directionIndex === undefined) throw new Error("fixture direction invalid");
    const target = projectTarget({ lie: point, lieTerrain: "fairway", club: "driver", power: 1, directionIndex, isInsideCourseBoundary: () => false });
    expect(predictionMarkers({ isAiming: false, target, path: [{ x: 2, y: 1 }] })).toEqual([]);
    const prediction = predictionMarkers({ isAiming: true, target, path: [{ x: 2, y: 1 }] });
    expect(prediction).toEqual([{ kind: "path", point: { x: 2, y: 1 } }, { kind: "target", point: target.position }]);
    expect(prediction.at(-1)?.point).toBe(target.position);
  });

  it("AC-REN-002-03 keeps Boundary, OOB Target, and transient OOB Ball width-safe and reset", () => {
    for (const item of [marker("boundary"), marker("target"), marker("ball")]) {
      const rendered = renderMarkerTile(item);
      expect(visibleWidth(rendered)).toBe(2);
      expect(rendered.endsWith(reset)).toBe(true);
    }
  });

  it("AC-REN-002-04 resolves every pair and representative multi-marker collision by the contract", () => {
    for (const [index, high] of MARKER_RENDERING_CONTRACT.entries()) {
      for (const low of MARKER_RENDERING_CONTRACT.slice(index + 1)) {
        expect(selectVisibleMarker([marker(low), marker(high)])?.kind).toBe(high);
        expect(selectVisibleMarker([marker(high), marker(low)])?.kind).toBe(high);
      }
    }
    expect(selectVisibleMarker(MARKER_RENDERING_CONTRACT.slice().reverse().map(marker))?.kind).toBe("ball");
  });

  it("AC-REN-004-01 computes styled and unstyled equal visible widths", () => {
    expect(visibleWidth(renderTerrainTile("fairway"))).toBe(visibleWidth("⠒⠒"));
    expect(visibleWidth(renderMarkerTile(marker("flag")))).toBe(visibleWidth("⚑ "));
  });

  it("AC-REN-004-02 truncates before style at complete tiles without partial ANSI, tiles, or overflow", () => {
    const terrain = ["green", "fairway", "water"] as const;
    expect(cropTerrainTiles(terrain, 5)).toEqual(["green", "fairway"]);
    expect(cropTerrainTiles(terrain, 1)).toEqual([]);
    const cropped = renderCroppedTerrainRow(terrain, 5);
    expect(visibleWidth(cropped)).toBe(4);
    expect(cropped.endsWith(reset)).toBe(true);
    expect(cropped).not.toContain("\u001b[38;2;166;218m");
  });

  it("AC-REN-004-03 preserves width when marker substitution replaces a Terrain tile", () => {
    expect(visibleWidth(renderMarkerTile(marker("target")))).toBe(visibleWidth(renderTerrainTile("water")));
    expect(visibleWidth(renderMarkerTile(marker("offscreen-arrow")))).toBe(2);
  });
});
