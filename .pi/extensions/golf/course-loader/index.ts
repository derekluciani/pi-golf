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
export { discoverCourses, formatCourseLoadIssue, loadCourseFile, loadSelectableCourseFile, readStableCourseFile, MAX_DISCOVERED_CANDIDATES, MAX_DISCOVERY_DEPTH, type CourseDiscoveryResult, type CourseFileLoadResult, type CourseLoadIssue, type CourseLoadIssueCode, type LoadedCourseFile } from "./loading.ts";
export { PREVIEW_COURSE_CATALOG, reconcileCourseCatalog, type CourseCatalog, type CourseCatalogInput, type CourseCatalogOption, type CourseCatalogPreview, type CourseCatalogWarning } from "./catalog.ts";
export { getCourseProjectPaths, isReservedBuiltInCourseId, PREVIEW_COURSE_ID, PREVIEW_COURSE_SETTINGS, PREVIEW_COURSE_SOURCE, readCourseSettings, writeCourseSettings, type CourseSettings, type CourseSettingsIssue, type CourseSettingsIssueCode, type CourseSettingsReadResult, type CourseSettingsWriteHooks } from "./settings.ts";
export { captureSelectedCourseSnapshot, selectCourseFromPath, selectLoadedCourse, type CourseSelectionWarning, type CourseSelectionWarningCode, type ExplicitCourseSelectionResult, type SelectedCourseSnapshot } from "./selection.ts";
export { buildCourseSettingsModel, COURSE_SETTING_ID, COURSE_SETTING_LABEL, createCourseSettingsComponent, GOLF_SETTINGS_TITLE, showCourseSettings, type CourseSettingOption, type CourseSettingsComponent, type CourseSettingsComponentOptions, type CourseSettingsModel } from "./ui.ts";
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
