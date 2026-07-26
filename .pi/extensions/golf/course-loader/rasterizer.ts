import type { Terrain } from "../domain/index.ts";
import {
  boundarySegments,
  polygonContainsPoint,
  rasterBounds,
  rasterCellCenter,
  shapeContainsPoint,
} from "./geometry.ts";
import {
  OUT_OF_BOUNDS,
  type Course,
  type CourseHole,
  type RasterizedCourse,
  type RasterizedHole,
  type RasterTerrain,
} from "./types.ts";

/**
 * Rasterizes a validated Hole by sampling only `(x + 0.5, y + 0.5)`.
 * Boundary segments remain separate rendering data and never overwrite cells.
 */
export function rasterizeHole(hole: CourseHole): RasterizedHole {
  const bounds = rasterBounds(hole.boundary);
  const cells: RasterTerrain[] = [];

  // Absolute coordinates may not advance by one at large finite offsets.
  for (let rowOffset = 0; rowOffset < bounds.height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < bounds.width; columnOffset += 1) {
      const center = rasterCellCenter(bounds, columnOffset, rowOffset);
      if (!polygonContainsPoint(hole.boundary, center)) {
        cells.push(OUT_OF_BOUNDS);
        continue;
      }

      let terrain: Terrain = "rough";
      for (const region of hole.regions) {
        if (shapeContainsPoint(region.shape, center)) terrain = region.terrain;
      }
      cells.push(terrain);
    }
  }

  return {
    bounds,
    cells,
    boundarySegments: boundarySegments(hole.boundary),
  };
}

export function rasterizeCourse(course: Course): RasterizedCourse {
  return { holes: course.holes.map(rasterizeHole) };
}

export function terrainAtCell(
  raster: RasterizedHole,
  x: number,
  y: number,
): RasterTerrain {
  if (!Number.isInteger(x) || !Number.isInteger(y)
    || x < raster.bounds.minX || x > raster.bounds.maxX
    || y < raster.bounds.minY || y > raster.bounds.maxY) return OUT_OF_BOUNDS;
  const index = (y - raster.bounds.minY) * raster.bounds.width + (x - raster.bounds.minX);
  return raster.cells[index] ?? OUT_OF_BOUNDS;
}

/** Hole Length is display-only and is never accepted from Course input. */
export function calculateHoleLength(hole: CourseHole): number {
  return Math.round(Math.hypot(hole.cup.x - hole.tee.x, hole.cup.y - hole.tee.y));
}
