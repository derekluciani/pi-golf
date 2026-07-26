export {
  COURSE_REQUIRED_PROPERTIES,
  COURSE_SCHEMA,
  COURSE_SCHEMA_VERSION,
  HOLE_REQUIRED_PROPERTIES,
  MAX_BOUNDARY_EXTENT,
  MAX_GEOMETRY_MAGNITUDE,
  MAX_HOLES,
  REGION_REQUIRED_PROPERTIES,
  SHAPE_TYPES,
} from "./schema.ts";
export {
  calculateHoleLength,
  rasterizeCourse,
  rasterizeHole,
  terrainAtCell,
} from "./rasterizer.ts";
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
  type RegionShape,
  type TerrainRegion,
} from "./types.ts";
