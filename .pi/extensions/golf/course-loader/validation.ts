import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";

import { TERRAINS, type Terrain } from "../domain/index.ts";
import {
  isValidCorridor,
  isValidPolygon,
  polygonBounds,
  polygonContainsPoint,
  rasterBounds,
  rasterCellCenter,
  shapeContainsPoint,
} from "./geometry.ts";
import {
  COURSE_SCHEMA,
  MAX_BOUNDARY_EXTENT,
  MAX_COURSE_DIAGNOSTICS,
  MAX_GEOMETRY_MAGNITUDE,
  MAX_TOTAL_RASTER_CELLS,
  SHAPE_TYPES,
} from "./schema.ts";
import { canonicalizeCourseWarnings } from "./warnings.ts";
import {
  OUT_OF_BOUNDS,
  type CorridorShape,
  type Course,
  type CourseDiagnostic,
  type CourseDiagnosticCode,
  type CourseHole,
  type CourseValidationResult,
  type CourseWarning,
  type Point,
  type PolygonShape,
  type RasterTerrain,
  type RegionShape,
  type TerrainRegion,
} from "./types.ts";

const validateStructureAgainstCourseSchema = new Ajv2020({
  allErrors: true,
  strict: true,
  verbose: true,
}).compile<Course>(COURSE_SCHEMA);

/** Structural-only acceptance compiled directly from the authoritative Course schema. */
export function validateCourseStructure(input: unknown): boolean {
  return validateStructureAgainstCourseSchema(input);
}

type UnknownRecord = Record<string, unknown>;
type ShapeType = (typeof SHAPE_TYPES)[number];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShapeType(value: unknown): value is ShapeType {
  return typeof value === "string" && SHAPE_TYPES.some((type) => type === value);
}

function isTerrain(value: unknown): value is Terrain {
  return typeof value === "string" && TERRAINS.some((terrain) => terrain === value);
}

function propertyPath(path: string, property: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(property)
    ? `${path}.${property}`
    : `${path}[${JSON.stringify(property)}]`;
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function pointerSegments(pointer: string): readonly string[] {
  if (pointer === "") return [];
  return pointer.slice(1).split("/").map(decodePointerSegment);
}

function pointerToJsonPath(pointer: string): string {
  return pointerSegments(pointer).reduce(
    (path, segment) => /^\d+$/u.test(segment) ? `${path}[${segment}]` : propertyPath(path, segment),
    "$",
  );
}

function valueAtPointer(input: unknown, pointer: string): unknown {
  let value = input;
  for (const segment of pointerSegments(pointer)) {
    if (Array.isArray(value) && /^\d+$/u.test(segment)) {
      value = value[Number(segment)];
    } else if (isRecord(value)) {
      value = value[segment];
    } else {
      return undefined;
    }
  }
  return value;
}

function isSparseArrayEntry(input: unknown, pointer: string): boolean {
  const segments = pointerSegments(pointer);
  const indexSegment = segments.at(-1);
  if (indexSegment === undefined || !/^\d+$/u.test(indexSegment)) return false;
  const parentPointer = segments.length === 1
    ? ""
    : `/${segments.slice(0, -1).map((segment) => segment.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
  const parent = valueAtPointer(input, parentPointer);
  return Array.isArray(parent) && !Object.hasOwn(parent, Number(indexSegment));
}

const shapeSchemaOwners = new WeakMap<object, ShapeType>();
const polygonSchema = COURSE_SCHEMA.$defs.polygon;
const ellipseSchema = COURSE_SCHEMA.$defs.ellipse;
const corridorSchema = COURSE_SCHEMA.$defs.corridor;
shapeSchemaOwners.set(polygonSchema, "polygon");
shapeSchemaOwners.set(polygonSchema.properties.points, "polygon");
shapeSchemaOwners.set(ellipseSchema, "ellipse");
shapeSchemaOwners.set(corridorSchema, "corridor");
shapeSchemaOwners.set(corridorSchema.properties.points, "corridor");

const shapeProperties = new Set(["type", "points", "center", "radiusX", "radiusY", "width"]);
const propertiesByShape: Readonly<Record<ShapeType, ReadonlySet<string>>> = {
  polygon: new Set(["type", "points"]),
  ellipse: new Set(["type", "center", "radiusX", "radiusY"]),
  corridor: new Set(["type", "points", "width"]),
};

function shapeRootPointer(instancePath: string): string | undefined {
  const match = /^(.*\/regions\/\d+\/shape)(?:\/.*)?$/u.exec(instancePath);
  return match?.[1];
}

/**
 * Ajv evaluates every `oneOf` branch. Keep the selected branch, or only common
 * independently meaningful failures when no supported discriminator is present.
 */
function isRelevantStructuralError(input: unknown, error: ErrorObject): boolean {
  const shapeRoot = shapeRootPointer(error.instancePath);
  if (shapeRoot === undefined) return true;
  if (error.keyword === "oneOf") return false;

  const shape = valueAtPointer(input, shapeRoot);
  if (!isRecord(shape)) {
    return error.keyword === "type" && error.instancePath === shapeRoot;
  }

  const declaredType = shape.type;
  const owner = isRecord(error.parentSchema)
    ? shapeSchemaOwners.get(error.parentSchema)
    : undefined;

  if (isShapeType(declaredType)) {
    if (error.keyword === "const" && error.instancePath === `${shapeRoot}/type`) return false;
    const nestedPath = error.instancePath.slice(shapeRoot.length + 1);
    const firstProperty = nestedPath.split("/", 1)[0];
    if (firstProperty !== undefined && firstProperty !== ""
      && !propertiesByShape[declaredType].has(decodePointerSegment(firstProperty))) return false;
    return owner === undefined || owner === declaredType;
  }

  if (error.keyword === "const" && error.instancePath === `${shapeRoot}/type`) return true;
  if (error.keyword === "required") {
    return error.params["missingProperty"] === "type";
  }
  if (error.keyword === "additionalProperties") {
    const property = error.params["additionalProperty"];
    return typeof property === "string" && !shapeProperties.has(property);
  }
  return false;
}

function diagnosticCode(input: unknown, error: ErrorObject, path: string): CourseDiagnosticCode {
  const lastProperty = /\.([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(path)?.[1];
  switch (error.keyword) {
    case "required":
      return "missing-property";
    case "additionalProperties":
      return "additional-property";
    case "const":
      return path === "$.schemaVersion" ? "invalid-schema-version" : "unsupported-shape";
    case "enum":
      return "unsupported-terrain";
    case "minLength":
    case "maxLength":
    case "pattern":
      return lastProperty === "name" ? "invalid-name" : "invalid-id";
    case "minItems":
    case "maxItems":
      if (path === "$.holes") return "invalid-hole-count";
      return valueAtPointer(input, error.instancePath.replace(/\/points$/u, "") + "/type") === "corridor"
        ? "invalid-corridor"
        : "invalid-polygon";
    case "exclusiveMinimum":
      return lastProperty === "width" ? "invalid-corridor" : "invalid-ellipse";
    case "minimum":
    case "maximum":
      if (lastProperty === "x" || lastProperty === "y") return "invalid-coordinate";
      if (lastProperty === "width") return "invalid-corridor";
      if (lastProperty === "radiusX" || lastProperty === "radiusY") return "invalid-ellipse";
      return lastProperty === "par" ? "invalid-par" : "invalid-number";
    case "type": {
      const expected = error.params["type"];
      if (expected === "object") {
        return isSparseArrayEntry(input, error.instancePath) ? "invalid-array" : "invalid-object";
      }
      if (expected === "array") return "invalid-array";
      if (lastProperty === "x" || lastProperty === "y") return "invalid-coordinate";
      if (lastProperty === "width") return "invalid-corridor";
      if (lastProperty === "radiusX" || lastProperty === "radiusY") return "invalid-ellipse";
      if (lastProperty === "terrain") return "unsupported-terrain";
      if (lastProperty === "type") return "unsupported-shape";
      if (lastProperty === "id") return "invalid-id";
      if (lastProperty === "name") return "invalid-name";
      if (lastProperty === "par") return "invalid-par";
      return expected === "integer" ? "invalid-number" : "invalid-string";
    }
    default:
      return "invalid-object";
  }
}

function diagnosticMessage(code: CourseDiagnosticCode, path: string): string {
  switch (code) {
    case "additional-property": return `Property at ${path} is not supported.`;
    case "invalid-coordinate": return `Coordinates must be finite and within inclusive [-${MAX_GEOMETRY_MAGNITUDE}, ${MAX_GEOMETRY_MAGNITUDE}].`;
    case "invalid-corridor": return `Corridor geometry must be valid and width must be > 0 and <= ${MAX_GEOMETRY_MAGNITUDE}.`;
    case "invalid-ellipse": return `Ellipse radii must be > 0 and <= ${MAX_GEOMETRY_MAGNITUDE}.`;
    case "invalid-hole-count": return "A Course must contain between 1 and 18 Holes.";
    case "invalid-id": return "Expected a non-blank ID string.";
    case "invalid-name": return "Expected a non-blank Course name.";
    case "invalid-number": return "Hole number must be an integer from 1 through 18.";
    case "invalid-object": return "Expected an object matching the version 1 Course schema.";
    case "invalid-par": return "Par must be 3, 4, or 5.";
    case "invalid-polygon": return "A polygon requires at least three valid vertices.";
    case "invalid-schema-version": return "Only schemaVersion 1 is supported.";
    case "invalid-string": return "Expected a string.";
    case "invalid-array": return "Expected a dense array of schema-valid entries.";
    case "missing-property": return `Required property at ${path} is missing.`;
    case "unsupported-shape": return "Unsupported shape type.";
    case "unsupported-terrain": return "Unsupported Terrain value.";
    default: return "Course validation failed.";
  }
}

function normalizeStructuralErrors(input: unknown, ajvErrors: readonly ErrorObject[]): CourseDiagnostic[] {
  const diagnostics: CourseDiagnostic[] = [];
  for (const error of ajvErrors) {
    if (!isRelevantStructuralError(input, error)) continue;
    let path = pointerToJsonPath(error.instancePath);
    if (error.keyword === "required") {
      const property = error.params["missingProperty"];
      if (typeof property === "string") path = propertyPath(path, property);
    } else if (error.keyword === "additionalProperties") {
      const property = error.params["additionalProperty"];
      if (typeof property === "string") path = propertyPath(path, property);
    }
    const code = diagnosticCode(input, error, path);
    diagnostics.push({ path, code, message: diagnosticMessage(code, path) });
  }
  return diagnostics;
}

function usableCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && value >= -MAX_GEOMETRY_MAGNITUDE && value <= MAX_GEOMETRY_MAGNITUDE;
}

function usablePoint(value: unknown): Point | undefined {
  if (!isRecord(value) || !usableCoordinate(value.x) || !usableCoordinate(value.y)) return undefined;
  return { x: value.x, y: value.y };
}

function usablePoints(value: unknown): readonly Point[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points: Point[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return undefined;
    const point = usablePoint(value[index]);
    if (point === undefined) return undefined;
    points.push(point);
  }
  return points;
}

function usablePositiveDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && value > 0 && value <= MAX_GEOMETRY_MAGNITUDE;
}

function semanticShape(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): RegionShape | undefined {
  if (!isRecord(value) || !isShapeType(value.type)) return undefined;
  switch (value.type) {
    case "polygon": {
      const points = usablePoints(value.points);
      if (points === undefined || points.length < 3) return undefined;
      const polygon: PolygonShape = { type: "polygon", points };
      if (!isValidPolygon(polygon)) {
        errors.push({ path, code: "invalid-polygon", message: "Polygon vertices must have non-zero area and no self-intersections." });
        return undefined;
      }
      return polygon;
    }
    case "ellipse": {
      const center = usablePoint(value.center);
      if (center === undefined || !usablePositiveDimension(value.radiusX)
        || !usablePositiveDimension(value.radiusY)) return undefined;
      return { type: "ellipse", center, radiusX: value.radiusX, radiusY: value.radiusY };
    }
    case "corridor": {
      const points = usablePoints(value.points);
      if (points === undefined || points.length < 2 || !usablePositiveDimension(value.width)) return undefined;
      const corridor: CorridorShape = { type: "corridor", points, width: value.width };
      if (!isValidCorridor(corridor)) {
        errors.push({ path, code: "invalid-corridor", message: "Corridor points must contain distinct consecutive vertices." });
        return undefined;
      }
      return corridor;
    }
  }
}

function semanticPolygon(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): PolygonShape | undefined {
  const shape = semanticShape(value, path, errors);
  return shape?.type === "polygon" ? shape : undefined;
}

function semanticRegions(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): readonly TerrainRegion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const regions: TerrainRegion[] = [];
  let completeListIsUsable = true;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      completeListIsUsable = false;
      continue;
    }
    const region = value[index];
    if (!isRecord(region)) {
      completeListIsUsable = false;
      continue;
    }
    const shape = semanticShape(region.shape, `${path}[${index}].shape`, errors);
    if (!isTerrain(region.terrain) || shape === undefined) {
      completeListIsUsable = false;
      continue;
    }
    regions.push({ terrain: region.terrain, shape });
  }
  return completeListIsUsable ? regions : undefined;
}

interface PartialHole {
  readonly id: string | undefined;
  readonly number: number | undefined;
  readonly boundary: PolygonShape | undefined;
  readonly tee: Point | undefined;
  readonly cup: Point | undefined;
  readonly regions: readonly TerrainRegion[] | undefined;
}

function semanticHole(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): PartialHole | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: typeof value.id === "string" && /\S/u.test(value.id) ? value.id : undefined,
    number: typeof value.number === "number" && Number.isInteger(value.number)
      && value.number >= 1 && value.number <= 18 ? value.number : undefined,
    boundary: semanticPolygon(value.boundary, `${path}.boundary`, errors),
    tee: usablePoint(value.tee),
    cup: usablePoint(value.cup),
    regions: semanticRegions(value.regions, `${path}.regions`, errors),
  };
}

function gameplayTerrain(
  boundary: PolygonShape,
  regions: readonly TerrainRegion[],
  point: Point,
): RasterTerrain {
  // Continuous Boundary is authoritative before owning-cell classification.
  if (!polygonContainsPoint(boundary, point)) return OUT_OF_BOUNDS;
  const center = { x: Math.floor(point.x) + 0.5, y: Math.floor(point.y) + 0.5 };
  if (!polygonContainsPoint(boundary, center)) return OUT_OF_BOUNDS;
  let terrain: Terrain = "rough";
  for (const region of regions) if (shapeContainsPoint(region.shape, center)) terrain = region.terrain;
  return terrain;
}

/** Authoritative Boundary-first gameplay Terrain lookup. */
export function terrainAtPoint(hole: CourseHole, point: Point): RasterTerrain {
  return gameplayTerrain(hole.boundary, hole.regions, point);
}

function regionAffectsCell(boundary: PolygonShape, region: TerrainRegion): boolean {
  const bounds = rasterBounds(boundary);
  for (let rowOffset = 0; rowOffset < bounds.height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < bounds.width; columnOffset += 1) {
      const center = rasterCellCenter(bounds, columnOffset, rowOffset);
      if (polygonContainsPoint(boundary, center) && shapeContainsPoint(region.shape, center)) return true;
    }
  }
  return false;
}

function validateHoleGeometry(
  hole: PartialHole,
  path: string,
  errors: CourseDiagnostic[],
  warnings: CourseWarning[],
): void {
  const boundary = hole.boundary;
  if (boundary === undefined) return;
  const bounds = polygonBounds(boundary);
  const boundaryTooLarge = bounds.maxX - bounds.minX > MAX_BOUNDARY_EXTENT
    || bounds.maxY - bounds.minY > MAX_BOUNDARY_EXTENT;
  if (boundaryTooLarge) {
    errors.push({
      path: `${path}.boundary`,
      code: "boundary-too-large",
      message: `Course Boundary bounding boxes may not exceed ${MAX_BOUNDARY_EXTENT} × ${MAX_BOUNDARY_EXTENT} units.`,
    });
  }

  for (const entry of [{ name: "tee", point: hole.tee }, { name: "cup", point: hole.cup }] as const) {
    if (entry.point === undefined) continue;
    const pointPath = `${path}.${entry.name}`;
    if (!polygonContainsPoint(boundary, entry.point)) {
      errors.push({ path: pointPath, code: "point-outside-boundary", message: `${entry.name} must be inside the Course Boundary.` });
      continue;
    }
    if (hole.regions === undefined) continue;
    const terrain = gameplayTerrain(boundary, hole.regions, entry.point);
    if (entry.name === "tee" && (terrain === OUT_OF_BOUNDS || terrain === "water" || terrain === "bunker")) {
      errors.push({ path: pointPath, code: "point-on-hazard", message: `tee must own playable non-hazard Terrain.` });
    }
    if (entry.name === "cup" && terrain !== "green") {
      errors.push({ path: pointPath, code: "cup-not-green", message: "Cup must resolve to Green after region layering." });
    }
  }

  if (boundaryTooLarge || hole.regions === undefined) return;
  hole.regions.forEach((region, index) => {
    if (!regionAffectsCell(boundary, region)) {
      warnings.push({
        path: `${path}.regions[${index}]`,
        code: "narrow-region",
        message: "Region does not affect any Terrain cell center inside the Course Boundary.",
        courseIndex: 0,
        holeIndex: Number(/holes\[(\d+)\]/u.exec(path)?.[1] ?? 0),
        regionIndex: index,
      });
    }
  });
}

function reportDuplicates(holes: readonly { readonly hole: PartialHole; readonly index: number }[], errors: CourseDiagnostic[]): void {
  const ids = new Map<string, number>();
  const numbers = new Map<number, number>();
  for (const { hole, index } of holes) {
    if (hole.id !== undefined) {
      const prior = ids.get(hole.id);
      if (prior === undefined) ids.set(hole.id, index);
      else errors.push({ path: `$.holes[${index}].id`, code: "duplicate-hole-id", message: `Hole ID duplicates $.holes[${prior}].id.` });
    }
    if (hole.number !== undefined) {
      const prior = numbers.get(hole.number);
      if (prior === undefined) numbers.set(hole.number, index);
      else errors.push({ path: `$.holes[${index}].number`, code: "duplicate-hole-number", message: `Hole number duplicates $.holes[${prior}].number.` });
    }
  }
}

function semanticDiagnostics(input: unknown): { errors: CourseDiagnostic[]; warnings: CourseWarning[] } {
  const errors: CourseDiagnostic[] = [];
  const warnings: CourseWarning[] = [];
  if (!isRecord(input) || !Array.isArray(input.holes)) return { errors, warnings };

  const holes: { hole: PartialHole; index: number }[] = [];
  for (let index = 0; index < input.holes.length; index += 1) {
    if (!Object.hasOwn(input.holes, index)) continue;
    const hole = semanticHole(input.holes[index], `$.holes[${index}]`, errors);
    if (hole !== undefined) holes.push({ hole, index });
  }
  reportDuplicates(holes, errors);
  let totalRasterCells = 0;
  for (const { hole, index } of holes) {
    validateHoleGeometry(hole, `$.holes[${index}]`, errors, warnings);
    if (hole.boundary !== undefined) {
      const bounds = rasterBounds(hole.boundary);
      totalRasterCells += bounds.width * bounds.height;
    }
  }
  if (totalRasterCells > MAX_TOTAL_RASTER_CELLS) errors.push({
    path: "$.holes", code: "raster-limit-exceeded",
    message: `Total raster cells may not exceed ${MAX_TOTAL_RASTER_CELLS}.`,
  });
  return { errors, warnings };
}

function mergeDiagnostics(...groups: readonly (readonly CourseDiagnostic[])[]): CourseDiagnostic[] {
  const diagnostics = new Map<string, CourseDiagnostic>();
  for (const group of groups) {
    for (const diagnostic of group) {
      const key = `${diagnostic.path}\u0000${diagnostic.code}`;
      if (!diagnostics.has(key)) diagnostics.set(key, diagnostic);
    }
  }
  const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
  const sorted = [...diagnostics.values()].sort((left, right) =>
    compare(left.path, right.path) || compare(left.code, right.code));
  if (sorted.length <= MAX_COURSE_DIAGNOSTICS) return sorted;
  return [...sorted.slice(0, MAX_COURSE_DIAGNOSTICS - 1), {
    path: "$", code: "diagnostics-truncated",
    message: `${sorted.length - MAX_COURSE_DIAGNOSTICS + 1} diagnostics omitted.`,
  }];
}

/**
 * Validates untrusted input without coercion or repair. Ajv is the sole source
 * of structural acceptance/diagnostics; the second pass adds only semantic rules.
 */
export function validateCourse(input: unknown): CourseValidationResult {
  let course: Course | undefined;
  if (validateStructureAgainstCourseSchema(input)) course = input;
  const structural = normalizeStructuralErrors(
    input,
    [...(validateStructureAgainstCourseSchema.errors ?? [])],
  );
  const semantic = semanticDiagnostics(input);
  const errors = mergeDiagnostics(structural, semantic.errors);
  const boundedWarnings = canonicalizeCourseWarnings(semantic.warnings);
  if (course === undefined || errors.length > 0) {
    const availableWarnings = Math.max(0, MAX_COURSE_DIAGNOSTICS - errors.length);
    return { ok: false, errors, warnings: boundedWarnings.slice(0, availableWarnings) };
  }
  return { ok: true, value: course, errors: [], warnings: boundedWarnings };
}

/** Alias emphasizing that successful validation also narrows unknown input. */
export const parseCourse = validateCourse;
