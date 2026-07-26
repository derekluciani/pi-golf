import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  OUT_OF_BOUNDS,
  calculateHoleLength,
  rasterizeHole,
  terrainAtCell,
  validateCourse,
  type CourseHole,
} from "./index.ts";

function validatedHole(regions: unknown[]): CourseHole {
  const result = validateCourse({
    schemaVersion: 1,
    id: "raster-course",
    name: "Raster Course",
    holes: [{
      id: "raster-hole",
      number: 1,
      par: 3,
      boundary: {
        type: "polygon",
        points: [
          { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 },
        ],
      },
      tee: { x: 0.5, y: 0.5 },
      cup: { x: 3.5, y: 3.5 },
      regions: [
        ...regions,
        {
          terrain: "green",
          shape: {
            type: "ellipse",
            center: { x: 3.5, y: 3.5 },
            radiusX: 0.6,
            radiusY: 0.6,
          },
        },
      ],
    }],
  });
  if (!result.ok) throw new Error(`Invalid raster fixture: ${JSON.stringify(result.errors)}`);
  const hole = result.value.holes[0];
  if (hole === undefined) throw new Error("Missing raster fixture Hole.");
  return hole;
}

describe("deterministic Terrain rasterization", () => {
  it("starts boundary interiors as Rough and samples cell centers", () => {
    const hole = validatedHole([{
      terrain: "fairway",
      shape: {
        type: "polygon",
        points: [
          { x: 0, y: 1 }, { x: 0.49, y: 1 }, { x: 0.49, y: 3 }, { x: 0, y: 3 },
        ],
      },
    }]);
    const raster = rasterizeHole(hole);

    // The region intersects cells geometrically, but no `(x + .5, y + .5)` sample.
    expect(terrainAtCell(raster, 0, 1)).toBe("rough");
    expect(terrainAtCell(raster, 1, 1)).toBe("rough");
    expect(terrainAtCell(raster, 3, 3)).toBe("green");
  });

  it("supports polygon, ellipse, and positive-width corridor coverage", () => {
    const hole = validatedHole([
      {
        terrain: "fairway",
        shape: {
          type: "polygon",
          points: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }],
        },
      },
      {
        terrain: "bunker",
        shape: {
          type: "ellipse",
          center: { x: 2.5, y: 1.5 },
          radiusX: 0.6,
          radiusY: 0.6,
        },
      },
      {
        terrain: "water",
        shape: {
          type: "corridor",
          points: [{ x: 0.5, y: 2.5 }, { x: 2.5, y: 2.5 }],
          width: 0.5,
        },
      },
    ]);
    const raster = rasterizeHole(hole);
    expect(terrainAtCell(raster, 0, 1)).toBe("fairway");
    expect(terrainAtCell(raster, 2, 1)).toBe("bunker");
    expect(terrainAtCell(raster, 1, 2)).toBe("water");
  });

  it("applies ordered regions with later regions overriding earlier ones", () => {
    const sharedShape = {
      type: "polygon",
      points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }],
    };
    const hole = validatedHole([
      { terrain: "bunker", shape: sharedShape },
      { terrain: "fairway", shape: sharedShape },
      {
        terrain: "water",
        shape: {
          type: "ellipse",
          center: { x: 2.5, y: 2.5 },
          radiusX: 0.6,
          radiusY: 0.6,
        },
      },
    ]);
    const raster = rasterizeHole(hole);
    expect(terrainAtCell(raster, 1, 1)).toBe("fairway");
    expect(terrainAtCell(raster, 2, 2)).toBe("water");
  });

  it("keeps Course Boundary rendering geometry separate from Terrain cells", () => {
    const hole = validatedHole([]);
    const raster = rasterizeHole(hole);
    expect(raster.boundarySegments).toHaveLength(4);
    expect(raster.boundarySegments[0]).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    });
    expect(raster.cells).not.toContain("boundary");
    expect(terrainAtCell(raster, -1, 0)).toBe(OUT_OF_BOUNDS);
  });

  it("marks sampled bounding-box cells outside a non-rectangular Boundary as OOB", () => {
    const result = validateCourse({
      schemaVersion: 1,
      id: "triangle",
      name: "Triangle",
      holes: [{
        id: "triangle-hole",
        number: 1,
        par: 3,
        boundary: {
          type: "polygon",
          points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }],
        },
        tee: { x: 0.5, y: 0.5 },
        cup: { x: 1, y: 1 },
        regions: [{
          terrain: "green",
          shape: {
            type: "ellipse",
            center: { x: 1, y: 1 },
            radiusX: 0.8,
            radiusY: 0.8,
          },
        }],
      }],
    });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const hole = result.value.holes[0];
    if (hole === undefined) throw new Error("Missing triangle Hole.");
    const raster = rasterizeHole(hole);
    expect(terrainAtCell(raster, 3, 3)).toBe(OUT_OF_BOUNDS);
    expect(terrainAtCell(raster, 0, 0)).toBe("green");
  });

  it("is byte-for-byte deterministic across repeated rasterization", () => {
    const hole = validatedHole([{
      terrain: "fairway",
      shape: {
        type: "corridor",
        points: [{ x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 }],
        width: 1,
      },
    }]);
    const first = Buffer.from(JSON.stringify(rasterizeHole(hole)));
    const second = Buffer.from(JSON.stringify(rasterizeHole(hole)));
    expect(first.equals(second)).toBe(true);
  });

  it("completes validation and repeated rasterization at a large finite offset", () => {
    const viteNodePath = fileURLToPath(
      new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url),
    );
    const probePath = fileURLToPath(new URL("./large-offset.probe.ts", import.meta.url));
    const probe = spawnSync(
      process.execPath,
      [viteNodePath, "--script", probePath],
      { encoding: "utf8", timeout: 5_000 },
    );

    expect(probe.error, probe.stderr).toBeUndefined();
    expect(probe.signal, probe.stderr).toBeNull();
    expect(probe.status, probe.stderr).toBe(0);
    expect(Number(probe.stdout.trim())).toBeGreaterThan(0);
  });

  it("calculates display Length instead of reading a declared value", () => {
    const hole = validatedHole([]);
    expect(calculateHoleLength(hole)).toBe(4);
  });
});
