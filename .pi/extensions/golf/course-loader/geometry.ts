import { orient2d } from "robust-predicates";

import type {
  BoundarySegment,
  CorridorShape,
  Point,
  PolygonShape,
  RasterBounds,
  RegionShape,
} from "./types.ts";

export interface GeometryBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function polygonBounds(polygon: PolygonShape): GeometryBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of polygon.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

/** Integer cells whose centers can lie within the polygon bounding box. */
export function rasterBounds(polygon: PolygonShape): RasterBounds {
  const bounds = polygonBounds(polygon);
  const rawMinX = Math.ceil(bounds.minX - 0.5);
  const rawMinY = Math.ceil(bounds.minY - 0.5);
  const rawMaxX = Math.floor(bounds.maxX - 0.5);
  const rawMaxY = Math.floor(bounds.maxY - 0.5);
  const minX = Object.is(rawMinX, -0) ? 0 : rawMinX;
  const minY = Object.is(rawMinY, -0) ? 0 : rawMinY;
  const maxX = Object.is(rawMaxX, -0) ? 0 : rawMaxX;
  const maxY = Object.is(rawMaxY, -0) ? 0 : rawMaxY;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX + 1),
    height: Math.max(0, maxY - minY + 1),
  };
}

/** Center sample for a bounded raster offset, preserving mathematical half-cell order. */
export function rasterCellCenter(
  bounds: RasterBounds,
  columnOffset: number,
  rowOffset: number,
): Point {
  return {
    x: bounds.minX + (columnOffset + 0.5),
    y: bounds.minY + (rowOffset + 0.5),
  };
}

export function boundarySegments(polygon: PolygonShape): readonly BoundarySegment[] {
  const first = polygon.points[0];
  if (first === undefined) return [];
  const segments: BoundarySegment[] = [];
  for (let index = 0; index < polygon.points.length; index += 1) {
    const start = polygon.points[index];
    const end = polygon.points[index + 1] ?? first;
    if (start !== undefined) segments.push({ start, end });
  }
  return segments;
}

function squaredDistance(left: Point, right: Point): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function orientation(first: Point, second: Point, third: Point): number {
  return orient2d(first.x, first.y, second.x, second.y, third.x, third.y);
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  if (orientation(start, end, point) !== 0) return false;
  return point.x >= Math.min(start.x, end.x)
    && point.x <= Math.max(start.x, end.x)
    && point.y >= Math.min(start.y, end.y)
    && point.y <= Math.max(start.y, end.y);
}

/** Boundary points count as inside for validation and Terrain classification. */
export function polygonContainsPoint(polygon: PolygonShape, point: Point): boolean {
  let inside = false;
  for (const segment of boundarySegments(polygon)) {
    if (pointOnSegment(point, segment.start, segment.end)) return true;

    const crossesRay = (segment.start.y > point.y) !== (segment.end.y > point.y);
    if (!crossesRay) continue;
    const crossingX = segment.start.x
      + ((point.y - segment.start.y) * (segment.end.x - segment.start.x))
        / (segment.end.y - segment.start.y);
    if (crossingX > point.x) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
): boolean {
  const firstSecondStart = orientation(firstStart, firstEnd, secondStart);
  const firstSecondEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondFirstStart = orientation(secondStart, secondEnd, firstStart);
  const secondFirstEnd = orientation(secondStart, secondEnd, firstEnd);

  if (((firstSecondStart > 0 && firstSecondEnd < 0)
      || (firstSecondStart < 0 && firstSecondEnd > 0))
    && ((secondFirstStart > 0 && secondFirstEnd < 0)
      || (secondFirstStart < 0 && secondFirstEnd > 0))) {
    return true;
  }

  return (firstSecondStart === 0 && pointOnSegment(secondStart, firstStart, firstEnd))
    || (firstSecondEnd === 0 && pointOnSegment(secondEnd, firstStart, firstEnd))
    || (secondFirstStart === 0 && pointOnSegment(firstStart, secondStart, secondEnd))
    || (secondFirstEnd === 0 && pointOnSegment(firstEnd, secondStart, secondEnd));
}

/** A valid polygon has three distinct vertices, non-zero area, and no self-intersection. */
export function isValidPolygon(polygon: PolygonShape): boolean {
  if (polygon.points.length < 3) return false;

  const segments = boundarySegments(polygon);
  for (const segment of segments) {
    if (squaredDistance(segment.start, segment.end) === 0) return false;
  }

  // A shoelace sum loses a thin polygon's area when large cross-products
  // cancel.  Exact-sign orientations instead establish that the vertices are
  // not all collinear without introducing a geometry-wide epsilon.
  const first = polygon.points[0];
  const second = polygon.points[1];
  if (first === undefined || second === undefined) return false;
  const hasNonCollinearVertex = polygon.points.slice(2)
    .some((point) => orientation(first, second, point) !== 0);
  if (!hasNonCollinearVertex) return false;

  for (let first = 0; first < segments.length; first += 1) {
    for (let second = first + 1; second < segments.length; second += 1) {
      const adjacent = second === first + 1 || (first === 0 && second === segments.length - 1);
      if (adjacent) continue;
      const firstSegment = segments[first];
      const secondSegment = segments[second];
      if (firstSegment !== undefined && secondSegment !== undefined
        && segmentsIntersect(
          firstSegment.start,
          firstSegment.end,
          secondSegment.start,
          secondSegment.end,
        )) return false;
    }
  }

  return true;
}

export function isValidCorridor(corridor: CorridorShape): boolean {
  if (!(corridor.width > 0) || corridor.points.length < 2) return false;
  for (let index = 1; index < corridor.points.length; index += 1) {
    const previous = corridor.points[index - 1];
    const current = corridor.points[index];
    if (previous === undefined || current === undefined
      || squaredDistance(previous, current) === 0) return false;
  }
  return true;
}

function squaredDistanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return squaredDistance(point, start);
  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return squaredDistance(point, {
    x: start.x + projection * dx,
    y: start.y + projection * dy,
  });
}

export function shapeContainsPoint(shape: RegionShape, point: Point): boolean {
  switch (shape.type) {
    case "polygon":
      return polygonContainsPoint(shape, point);
    case "ellipse": {
      const normalizedX = (point.x - shape.center.x) / shape.radiusX;
      const normalizedY = (point.y - shape.center.y) / shape.radiusY;
      return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
    }
    case "corridor": {
      const maximumSquaredDistance = (shape.width / 2) ** 2;
      for (let index = 1; index < shape.points.length; index += 1) {
        const start = shape.points[index - 1];
        const end = shape.points[index];
        if (start !== undefined && end !== undefined
          && squaredDistanceToSegment(point, start, end)
            <= maximumSquaredDistance) return true;
      }
      return false;
    }
  }
}
