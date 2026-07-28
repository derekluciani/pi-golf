export {
  COURSE_REQUIRED_PROPERTIES,
  COURSE_SCHEMA,
  COURSE_SCHEMA_VERSION,
  HOLE_REQUIRED_PROPERTIES,
  MAX_BOUNDARY_EXTENT,
  MAX_COURSE_DIAGNOSTICS,
  MAX_COURSE_JSON_BYTES,
  MAX_GEOMETRY_MAGNITUDE,
  MAX_HOLES,
  MAX_POINTS_PER_SHAPE,
  MAX_REGIONS_PER_HOLE,
  MAX_TOTAL_RASTER_CELLS,
  REGION_REQUIRED_PROPERTIES,
  SHAPE_TYPES,
} from "./schema.ts";
export {
  calculateHoleLength,
  rasterizeCourse,
  rasterizeHole,
  terrainAtCell,
} from "./rasterizer.ts";
export { parseCourseJson } from "./raw-parser.ts";
export { canonicalizeCourseWarnings } from "./warnings.ts";
export { createRoundCourseSnapshot } from "./snapshot.ts";
export { parseCourse, terrainAtPoint, validateCourse, validateCourseStructure } from "./validation.ts";
export {
  OUT_OF_BOUNDS,
  type BoundarySegment,
  type CorridorShape,
  type Course,
  type CourseDiagnostic,
  type CourseDiagnosticCode,
  type CourseHole,
  type CourseValidationResult,
  type CourseWarning,
  type CourseWarningCode,
  type EllipseShape,
  type Point,
  type PolygonShape,
  type RasterBounds,
  type RasterizedCourse,
  type RasterizedHole,
  type RasterTerrain,
  type RoundCourseSnapshot,
  type RegionShape,
  type TerrainRegion,
} from "./types.ts";
