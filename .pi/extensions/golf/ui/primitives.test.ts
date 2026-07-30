import { describe, expect, it } from "vitest";

import { parseShotDirectionIndex } from "../domain/index.ts";
import { projectTarget, resolveShot } from "../simulation/index.ts";
import { goalMarkerForShotOrigin, predictionMarkers, type MarkerKind, type RenderMarker } from "./rendering-model.ts";
import { MARKER_RENDERING_CONTRACT, cropTerrainTiles, markerGlyph, renderCroppedTerrainRow, renderMarkerTile, renderTerrainRow, renderTerrainTile, selectVisibleMarker, visibleWidth } from "./primitives.ts";

const reset = "\u001b[0m";
const point = { x: 1, y: 1 };
const marker = (kind: MarkerKind, markerPoint = point): RenderMarker => ({ kind, point: markerPoint });

const terrainSnapshots = [
  ["green", "\u001b[38;2;166;218;149m⠁⠈\u001b[0m"],
  ["fairway", "\u001b[38;2;166;218;149m⠒⠒\u001b[0m"],
  ["rough", "\u001b[38;2;166;218;149m⣶⣶\u001b[0m"],
  ["bunker", "\u001b[38;2;238;212;159m⠶⠶\u001b[0m"],
  ["water", "\u001b[38;2;138;173;244m⠛⣤\u001b[0m"],
] as const;

const markerSnapshots = [
  ["ball", "\u001b[38;2;244;219;214m● \u001b[0m"],
  ["cup", "\u001b[38;2;202;211;245m○ \u001b[0m"],
  ["flag", "\u001b[38;2;237;135;150m⚑ \u001b[0m"],
  ["target", "\u001b[38;2;237;135;150m╳ \u001b[0m"],
  ["path", "\u001b[38;2;147;154;183m· \u001b[0m"],
  ["boundary", "\u001b[38;2;91;96;120m× \u001b[0m"],
  ["offscreen-arrow", "\u001b[38;2;245;169;127m↑ \u001b[0m"],
] as const satisfies readonly [MarkerKind, string][];

describe("V2-REN rendering primitives", () => {
  it("AC-REN-001-01 snapshots fixed PRD Terrain glyphs, colors, two-column width, default background, and row reset", () => {
    for (const [terrain, expected] of terrainSnapshots) {
      const tile = renderTerrainTile(terrain);
      expect(tile).toBe(expected);
      expect(visibleWidth(tile)).toBe(2);
      expect(tile).not.toContain("48;");
    }
    expect(renderTerrainRow(["green"])).toBe("\u001b[38;2;166;218;149m⠁⠈\u001b[0m\u001b[0m");
  });

  it("AC-REN-001-02 snapshots exact unstyled OOB tiles and reset Boundary transitions", () => {
    expect(renderTerrainTile("out-of-bounds")).toBe("  ");
    const row = renderTerrainRow(["green", "out-of-bounds", "water", "out-of-bounds"]);
    expect(row).toBe("\u001b[38;2;166;218;149m⠁⠈\u001b[0m  \u001b[38;2;138;173;244m⠛⣤\u001b[0m  \u001b[0m");
    expect(visibleWidth(row)).toBe(8);
  });

  it("AC-REN-001-03 distinguishes every Terrain solely by its fixed pattern", () => {
    const patterns = terrainSnapshots.map(([, snapshot]) => snapshot.slice(snapshot.indexOf("m") + 1, -reset.length));
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(patterns).toEqual(["⠁⠈", "⠒⠒", "⣶⣶", "⠶⠶", "⠛⣤"]);
  });

  it("AC-REN-002-01 snapshots fixed PRD marker glyphs/colors, switches Flag/Cup, and keeps hidden Cup capture active", () => {
    expect(goalMarkerForShotOrigin("fairway")).toBe("flag");
    expect(goalMarkerForShotOrigin("green")).toBe("cup");
    expect(goalMarkerForShotOrigin("rough")).toBe("flag");
    for (const [kind, expected] of markerSnapshots) {
      const rendered = renderMarkerTile(marker(kind));
      expect(rendered).toBe(expected);
      expect(visibleWidth(rendered)).toBe(2);
    }
    expect(["up", "down", "left", "right", "up-left", "up-right", "down-left", "down-right"].map((arrow) => markerGlyph({ ...marker("offscreen-arrow"), arrow: arrow as "up" | "down" | "left" | "right" | "up-left" | "up-right" | "down-left" | "down-right" }))).toEqual(["↑", "↓", "←", "→", "↖", "↗", "↙", "↘"]);

    // This fairway-origin Shot displays Flag, but resolveShot receives only the authoritative Cup.
    const hiddenCup = { x: 0.55, y: 0 };
    expect(renderMarkerTile(marker(goalMarkerForShotOrigin("fairway"), hiddenCup))).toBe("\u001b[38;2;237;135;150m⚑ \u001b[0m");
    const captured = resolveShot({
      shotId: "hidden-cup-capture",
      round: { lie: { x: 0, y: 0 }, playedStrokes: 0, penaltyStrokes: 0, selectedClub: "putter", directionIndex: 0 as never },
      power: 0.1,
      originalLieTerrain: "fairway",
      cup: hiddenCup,
      terrainAt: () => "green",
      courseBoundarySweep: () => null,
    });
    expect(captured.terminal).toBe("cup");
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

  it("AC-REN-002-03 renders Boundary, outside-boundary Target, and transient OOB Ball fixtures width-safe without ANSI leakage", () => {
    const boundary = marker("boundary", { x: 60, y: 12 });
    const outsideBoundaryTarget = marker("target", { x: 60.25, y: -1 });
    const transientOobBall = marker("ball", { x: -0.25, y: 60.5 });
    const fixtures = [
      [boundary, "\u001b[38;2;91;96;120m× \u001b[0m"],
      [outsideBoundaryTarget, "\u001b[38;2;237;135;150m╳ \u001b[0m"],
      [transientOobBall, "\u001b[38;2;244;219;214m● \u001b[0m"],
    ] as const;
    for (const [item, expected] of fixtures) {
      const rendered = renderMarkerTile(item);
      expect(rendered).toBe(expected);
      expect(visibleWidth(rendered)).toBe(2);
      expect(rendered.endsWith(reset)).toBe(true);
      expect(rendered).not.toContain("48;");
    }
  });

  it("AC-REN-002-04 resolves every pair and representative multi-marker collision by the contract", () => {
    for (const [index, high] of MARKER_RENDERING_CONTRACT.entries()) {
      for (const low of MARKER_RENDERING_CONTRACT.slice(index + 1)) {
        expect(selectVisibleMarker([marker(low), marker(high)])?.kind).toBe(high);
        expect(selectVisibleMarker([marker(high), marker(low)])?.kind).toBe(high);
      }
    }
    expect(selectVisibleMarker(MARKER_RENDERING_CONTRACT.slice().reverse().map((kind) => marker(kind)))?.kind).toBe("ball");
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
