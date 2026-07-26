import { describe, expect, it } from "vitest";

import {
  MAX_GEOMETRY_MAGNITUDE,
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

  it("rasterizes exact 8 × 8 cells near both valid coordinate limits", () => {
    for (const origin of [MAX_GEOMETRY_MAGNITUDE - 8, -MAX_GEOMETRY_MAGNITUDE]) {
      const result = validateCourse({
        schemaVersion: 1,
        id: `limit-${origin}`,
        name: "Limit Course",
        holes: [{
          id: "limit-hole",
          number: 1,
          par: 3,
          boundary: {
            type: "polygon",
            points: [
              { x: origin, y: 0 },
              { x: origin + 8, y: 0 },
              { x: origin + 8, y: 8 },
              { x: origin, y: 8 },
            ],
          },
          tee: { x: origin + 0.5, y: 0.5 },
          cup: { x: origin + 7.5, y: 7.5 },
          regions: [{
            terrain: "green",
            shape: {
              type: "polygon",
              points: [
                { x: origin + 4, y: 0 },
                { x: origin + 8, y: 0 },
                { x: origin + 8, y: 8 },
                { x: origin + 4, y: 8 },
              ],
            },
          }],
        }],
      });
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      const hole = result.value.holes[0];
      if (hole === undefined) throw new Error("Missing limit Hole.");

      const first = rasterizeHole(hole);
      const second = rasterizeHole(hole);
      expect(first.bounds).toEqual({
        minX: origin,
        minY: 0,
        maxX: origin + 7,
        maxY: 7,
        width: 8,
        height: 8,
      });
      expect(first.cells).toHaveLength(64);
      expect(first.cells.filter((terrain) => terrain === "rough")).toHaveLength(32);
      expect(first.cells.filter((terrain) => terrain === "green")).toHaveLength(32);
      expect(terrainAtCell(first, origin + 3, 4)).toBe("rough");
      expect(terrainAtCell(first, origin + 4, 4)).toBe("green");
      expect(Buffer.from(JSON.stringify(first)).equals(Buffer.from(JSON.stringify(second)))).toBe(true);
    }
  });

  it("calculates display Length instead of reading a declared value", () => {
    const hole = validatedHole([]);
    expect(calculateHoleLength(hole)).toBe(4);
  });
});
