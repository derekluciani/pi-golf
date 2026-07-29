import type { Point as DomainPoint, Terrain } from "../domain/index.ts";

/** Course geometry uses the shared continuous-coordinate Point type. */
export type Point = DomainPoint;

export interface PolygonShape {
  readonly type: "polygon";
  readonly points: readonly Point[];
}

export interface EllipseShape {
  readonly type: "ellipse";
  readonly center: Point;
  readonly radiusX: number;
  readonly radiusY: number;
}

export interface CorridorShape {
  readonly type: "corridor";
  readonly points: readonly Point[];
  readonly width: number;
}

export type RegionShape = PolygonShape | EllipseShape | CorridorShape;

export interface TerrainRegion {
  readonly terrain: Terrain;
  readonly shape: RegionShape;
}

export interface CourseHole {
  readonly id: string;
  readonly number: number;
  readonly par: 3 | 4 | 5;
  readonly boundary: PolygonShape;
  readonly tee: Point;
  readonly cup: Point;
  readonly regions: readonly TerrainRegion[];
}

export interface Course {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  /** Course order is the array order; Hole number is independent. */
  readonly holes: readonly CourseHole[];
}

export type CourseDiagnosticCode =
  | "additional-property"
  | "boundary-too-large"
  | "cup-not-green"
  | "duplicate-hole-id"
  | "duplicate-hole-number"
  | "invalid-array"
  | "invalid-coordinate"
  | "invalid-corridor"
  | "invalid-ellipse"
  | "invalid-hole-count"
  | "invalid-id"
  | "invalid-name"
  | "invalid-number"
  | "invalid-object"
  | "invalid-par"
  | "invalid-polygon"
  | "invalid-schema-version"
  | "invalid-string"
  | "missing-property"
  | "duplicate-key"
  | "input-too-large"
  | "raster-limit-exceeded"
  | "diagnostics-truncated"
  | "point-outside-boundary"
  | "point-on-hazard"
  | "unsupported-shape"
  | "unsupported-terrain";

export type CourseWarningCode = "narrow-region" | "diagnostics-truncated";

export interface CourseDiagnostic {
  /** JSONPath rooted at `$`, for example `$.holes[0].tee.x`. */
  readonly path: string;
  readonly code: CourseDiagnosticCode;
  readonly message: string;
}

export interface CourseWarning {
  readonly path: string;
  readonly code: CourseWarningCode;
  readonly message: string;
  readonly sourcePath?: string;
  readonly courseIndex?: number;
  readonly holeIndex?: number;
  readonly regionIndex?: number;
}

export type CourseValidationResult =
  | {
      readonly ok: true;
      readonly value: Course;
      readonly errors: readonly [];
      readonly warnings: readonly CourseWarning[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly CourseDiagnostic[];
      readonly warnings: readonly CourseWarning[];
    };

export const OUT_OF_BOUNDS = "out-of-bounds" as const;
export type RasterTerrain = Terrain | typeof OUT_OF_BOUNDS;

export interface RasterBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface BoundarySegment {
  readonly start: Point;
  readonly end: Point;
}

export interface RasterizedHole {
  readonly bounds: RasterBounds;
  /** Deterministic row-major cells, beginning at `(minX, minY)`. */
  readonly cells: readonly RasterTerrain[];
  /** Geometry for boundary rendering; boundary pixels are not Terrain cells. */
  readonly boundarySegments: readonly BoundarySegment[];
}

export interface RasterizedCourse {
  readonly holes: readonly RasterizedHole[];
}

/** Immutable Course graph persisted once by the future Round-store boundary. */
export interface RoundCourseSnapshot {
  readonly course: Course;
  readonly serializedCourse: string;
}
