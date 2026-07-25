import { TERRAINS, type Terrain } from "../domain/index.ts";
import {
  isValidCorridor,
  isValidPolygon,
  polygonBounds,
  polygonContainsPoint,
  rasterBounds,
  shapeContainsPoint,
} from "./geometry.ts";
import {
  COURSE_REQUIRED_PROPERTIES,
  COURSE_SCHEMA_VERSION,
  HOLE_REQUIRED_PROPERTIES,
  MAX_BOUNDARY_EXTENT,
  MAX_HOLES,
  REGION_REQUIRED_PROPERTIES,
  SHAPE_TYPES,
} from "./schema.ts";
import {
  OUT_OF_BOUNDS,
  type CorridorShape,
  type CourseDiagnostic,
  type CourseDiagnosticCode,
  type CourseHole,
  type CourseValidationResult,
  type CourseWarning,
  type EllipseShape,
  type Point,
  type PolygonShape,
  type RasterTerrain,
  type RegionShape,
  type TerrainRegion,
} from "./types.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function propertyPath(path: string, property: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(property)
    ? `${path}.${property}`
    : `${path}[${JSON.stringify(property)}]`;
}

function addError(
  errors: CourseDiagnostic[],
  path: string,
  code: CourseDiagnosticCode,
  message: string,
): void {
  errors.push({ path, code, message });
}

function inspectObject(
  value: unknown,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
  errors: CourseDiagnostic[],
): UnknownRecord | undefined {
  if (!isRecord(value)) {
    addError(errors, path, "invalid-object", "Expected an object.");
    return undefined;
  }

  const allowedProperties = new Set(allowed);
  for (const property of Object.keys(value)) {
    if (!allowedProperties.has(property)) {
      addError(
        errors,
        propertyPath(path, property),
        "additional-property",
        `Property '${property}' is not supported.`,
      );
    }
  }
  for (const property of required) {
    if (!Object.hasOwn(value, property)) {
      addError(
        errors,
        propertyPath(path, property),
        "missing-property",
        `Required property '${property}' is missing.`,
      );
    }
  }
  return value;
}

function parseNonBlankString(
  value: unknown,
  path: string,
  code: "invalid-id" | "invalid-name",
  errors: CourseDiagnostic[],
): string | undefined {
  if (typeof value !== "string" || !/\S/u.test(value)) {
    addError(errors, path, code, "Expected a non-blank string.");
    return undefined;
  }
  return value;
}

function parseCoordinate(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addError(errors, path, "invalid-coordinate", "Expected a finite coordinate.");
    return undefined;
  }
  return value;
}

function parsePoint(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): Point | undefined {
  const record = inspectObject(value, path, ["x", "y"], ["x", "y"], errors);
  if (record === undefined) return undefined;
  const x = Object.hasOwn(record, "x") ? parseCoordinate(record.x, `${path}.x`, errors) : undefined;
  const y = Object.hasOwn(record, "y") ? parseCoordinate(record.y, `${path}.y`, errors) : undefined;
  return x === undefined || y === undefined ? undefined : { x, y };
}

function parsePoints(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): readonly Point[] | undefined {
  if (!Array.isArray(value)) {
    addError(errors, path, "invalid-array", "Expected an array of points.");
    return undefined;
  }
  const parsed = value.map((point, index) => parsePoint(point, `${path}[${index}]`, errors));
  return parsed.every((point): point is Point => point !== undefined) ? parsed : undefined;
}

function parsePolygon(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): PolygonShape | undefined {
  const record = inspectObject(value, path, ["type", "points"], ["type", "points"], errors);
  if (record === undefined) return undefined;

  let validType = false;
  if (Object.hasOwn(record, "type")) {
    validType = record.type === "polygon";
    if (!validType) {
      addError(errors, `${path}.type`, "unsupported-shape", "Expected shape type 'polygon'.");
    }
  }
  const points = Object.hasOwn(record, "points")
    ? parsePoints(record.points, `${path}.points`, errors)
    : undefined;
  if (!validType || points === undefined) return undefined;

  const polygon: PolygonShape = { type: "polygon", points };
  if (!isValidPolygon(polygon)) {
    addError(
      errors,
      path,
      "invalid-polygon",
      "A polygon requires at least three vertices, non-zero area, and no self-intersections.",
    );
    return undefined;
  }
  return polygon;
}

function parsePositiveDimension(
  value: unknown,
  path: string,
  code: "invalid-corridor" | "invalid-ellipse",
  errors: CourseDiagnostic[],
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    addError(errors, path, code, "Expected a finite dimension greater than zero.");
    return undefined;
  }
  return value;
}

function parseEllipse(
  record: UnknownRecord,
  path: string,
  errors: CourseDiagnostic[],
): EllipseShape | undefined {
  inspectObject(
    record,
    path,
    ["type", "center", "radiusX", "radiusY"],
    ["type", "center", "radiusX", "radiusY"],
    errors,
  );
  const center = Object.hasOwn(record, "center")
    ? parsePoint(record.center, `${path}.center`, errors)
    : undefined;
  const radiusX = Object.hasOwn(record, "radiusX")
    ? parsePositiveDimension(record.radiusX, `${path}.radiusX`, "invalid-ellipse", errors)
    : undefined;
  const radiusY = Object.hasOwn(record, "radiusY")
    ? parsePositiveDimension(record.radiusY, `${path}.radiusY`, "invalid-ellipse", errors)
    : undefined;
  return center === undefined || radiusX === undefined || radiusY === undefined
    ? undefined
    : { type: "ellipse", center, radiusX, radiusY };
}

function parseCorridor(
  record: UnknownRecord,
  path: string,
  errors: CourseDiagnostic[],
): CorridorShape | undefined {
  inspectObject(record, path, ["type", "points", "width"], ["type", "points", "width"], errors);
  const points = Object.hasOwn(record, "points")
    ? parsePoints(record.points, `${path}.points`, errors)
    : undefined;
  const width = Object.hasOwn(record, "width")
    ? parsePositiveDimension(record.width, `${path}.width`, "invalid-corridor", errors)
    : undefined;
  if (points === undefined || width === undefined) return undefined;

  const corridor: CorridorShape = { type: "corridor", points, width };
  if (!isValidCorridor(corridor)) {
    addError(
      errors,
      path,
      "invalid-corridor",
      "A corridor requires at least two distinct consecutive polyline points and positive width.",
    );
    return undefined;
  }
  return corridor;
}

function parseShape(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): RegionShape | undefined {
  if (!isRecord(value)) {
    addError(errors, path, "invalid-object", "Expected a shape object.");
    return undefined;
  }
  if (!Object.hasOwn(value, "type")) {
    addError(errors, `${path}.type`, "missing-property", "Required property 'type' is missing.");
    return undefined;
  }
  if (typeof value.type !== "string" || !SHAPE_TYPES.some((type) => type === value.type)) {
    addError(errors, `${path}.type`, "unsupported-shape", "Unsupported shape type.");
    return undefined;
  }

  switch (value.type) {
    case "polygon":
      return parsePolygon(value, path, errors);
    case "ellipse":
      return parseEllipse(value, path, errors);
    case "corridor":
      return parseCorridor(value, path, errors);
  }
}

function isTerrain(value: string): value is Terrain {
  return TERRAINS.some((terrain) => terrain === value);
}

function parseTerrain(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): Terrain | undefined {
  if (typeof value !== "string" || !isTerrain(value)) {
    addError(errors, path, "unsupported-terrain", "Unsupported Terrain value.");
    return undefined;
  }
  return value;
}

function parseRegion(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): TerrainRegion | undefined {
  const record = inspectObject(
    value,
    path,
    REGION_REQUIRED_PROPERTIES,
    REGION_REQUIRED_PROPERTIES,
    errors,
  );
  if (record === undefined) return undefined;
  const terrain = Object.hasOwn(record, "terrain")
    ? parseTerrain(record.terrain, `${path}.terrain`, errors)
    : undefined;
  const shape = Object.hasOwn(record, "shape")
    ? parseShape(record.shape, `${path}.shape`, errors)
    : undefined;
  return terrain === undefined || shape === undefined ? undefined : { terrain, shape };
}

function parseRegions(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): readonly TerrainRegion[] | undefined {
  if (!Array.isArray(value)) {
    addError(errors, path, "invalid-array", "Expected an ordered array of Terrain regions.");
    return undefined;
  }
  const regions = value.map((region, index) => parseRegion(region, `${path}[${index}]`, errors));
  return regions.every((region): region is TerrainRegion => region !== undefined)
    ? regions
    : undefined;
}

function parseHoleNumber(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): number | undefined {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > 18) {
    addError(errors, path, "invalid-number", "Hole number must be an integer from 1 through 18.");
    return undefined;
  }
  return value;
}

function parsePar(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): 3 | 4 | 5 | undefined {
  if (value !== 3 && value !== 4 && value !== 5) {
    addError(errors, path, "invalid-par", "Par must be 3, 4, or 5.");
    return undefined;
  }
  return value;
}

function parseHole(
  value: unknown,
  path: string,
  errors: CourseDiagnostic[],
): CourseHole | undefined {
  const record = inspectObject(
    value,
    path,
    HOLE_REQUIRED_PROPERTIES,
    HOLE_REQUIRED_PROPERTIES,
    errors,
  );
  if (record === undefined) return undefined;

  const id = Object.hasOwn(record, "id")
    ? parseNonBlankString(record.id, `${path}.id`, "invalid-id", errors)
    : undefined;
  const number = Object.hasOwn(record, "number")
    ? parseHoleNumber(record.number, `${path}.number`, errors)
    : undefined;
  const par = Object.hasOwn(record, "par")
    ? parsePar(record.par, `${path}.par`, errors)
    : undefined;
  const boundary = Object.hasOwn(record, "boundary")
    ? parsePolygon(record.boundary, `${path}.boundary`, errors)
    : undefined;
  const tee = Object.hasOwn(record, "tee")
    ? parsePoint(record.tee, `${path}.tee`, errors)
    : undefined;
  const cup = Object.hasOwn(record, "cup")
    ? parsePoint(record.cup, `${path}.cup`, errors)
    : undefined;
  const regions = Object.hasOwn(record, "regions")
    ? parseRegions(record.regions, `${path}.regions`, errors)
    : undefined;

  return id === undefined || number === undefined || par === undefined
      || boundary === undefined || tee === undefined || cup === undefined || regions === undefined
    ? undefined
    : { id, number, par, boundary, tee, cup, regions };
}

/** Resolves continuous geometry in region order, independently of cell rasterization. */
export function terrainAtPoint(hole: CourseHole, point: Point): RasterTerrain {
  if (!polygonContainsPoint(hole.boundary, point)) return OUT_OF_BOUNDS;
  let terrain: Terrain = "rough";
  for (const region of hole.regions) {
    if (shapeContainsPoint(region.shape, point)) terrain = region.terrain;
  }
  return terrain;
}

function regionAffectsCell(hole: CourseHole, region: TerrainRegion): boolean {
  const bounds = rasterBounds(hole.boundary);
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const center = { x: x + 0.5, y: y + 0.5 };
      if (polygonContainsPoint(hole.boundary, center)
        && shapeContainsPoint(region.shape, center)) return true;
    }
  }
  return false;
}

function validateHoleGeometry(
  hole: CourseHole,
  path: string,
  errors: CourseDiagnostic[],
  warnings: CourseWarning[],
): void {
  const bounds = polygonBounds(hole.boundary);
  const boundaryTooLarge = bounds.maxX - bounds.minX > MAX_BOUNDARY_EXTENT
    || bounds.maxY - bounds.minY > MAX_BOUNDARY_EXTENT;
  if (boundaryTooLarge) {
    addError(
      errors,
      `${path}.boundary`,
      "boundary-too-large",
      `Course Boundary bounding boxes may not exceed ${MAX_BOUNDARY_EXTENT} × ${MAX_BOUNDARY_EXTENT} units.`,
    );
  }

  const points = [
    { name: "tee", point: hole.tee },
    { name: "cup", point: hole.cup },
  ] as const;
  for (const entry of points) {
    const pointPath = `${path}.${entry.name}`;
    if (!polygonContainsPoint(hole.boundary, entry.point)) {
      addError(errors, pointPath, "point-outside-boundary", `${entry.name} must be inside the Course Boundary.`);
      continue;
    }
    const terrain = terrainAtPoint(hole, entry.point);
    if (terrain === "water" || terrain === "bunker") {
      addError(errors, pointPath, "point-on-hazard", `${entry.name} may not resolve to ${terrain}.`);
    }
    if (entry.name === "cup" && terrain !== "green") {
      addError(errors, pointPath, "cup-not-green", "Cup must resolve to Green after region layering.");
    }
  }

  if (boundaryTooLarge) return;
  hole.regions.forEach((region, index) => {
    if (!regionAffectsCell(hole, region)) {
      warnings.push({
        path: `${path}.regions[${index}]`,
        code: "narrow-region",
        message: "Region does not affect any Terrain cell center inside the Course Boundary.",
      });
    }
  });
}

interface IndexedHole {
  readonly hole: CourseHole;
  readonly index: number;
}

function reportDuplicates(holes: readonly IndexedHole[], errors: CourseDiagnostic[]): void {
  const ids = new Map<string, number>();
  const numbers = new Map<number, number>();
  holes.forEach(({ hole, index }) => {
    const priorId = ids.get(hole.id);
    if (priorId === undefined) ids.set(hole.id, index);
    else addError(
      errors,
      `$.holes[${index}].id`,
      "duplicate-hole-id",
      `Hole ID duplicates $.holes[${priorId}].id.`,
    );

    const priorNumber = numbers.get(hole.number);
    if (priorNumber === undefined) numbers.set(hole.number, index);
    else addError(
      errors,
      `$.holes[${index}].number`,
      "duplicate-hole-number",
      `Hole number duplicates $.holes[${priorNumber}].number.`,
    );
  });
}

/**
 * Parses untrusted input without coercion or repair and reports every
 * independently discoverable validation failure with a JSONPath.
 */
export function validateCourse(input: unknown): CourseValidationResult {
  const errors: CourseDiagnostic[] = [];
  const warnings: CourseWarning[] = [];
  const record = inspectObject(
    input,
    "$",
    COURSE_REQUIRED_PROPERTIES,
    COURSE_REQUIRED_PROPERTIES,
    errors,
  );
  if (record === undefined) return { ok: false, errors, warnings };

  let schemaVersion: 1 | undefined;
  if (Object.hasOwn(record, "schemaVersion")) {
    if (record.schemaVersion === COURSE_SCHEMA_VERSION) schemaVersion = COURSE_SCHEMA_VERSION;
    else addError(
      errors,
      "$.schemaVersion",
      "invalid-schema-version",
      `Only schemaVersion ${COURSE_SCHEMA_VERSION} is supported.`,
    );
  }
  const id = Object.hasOwn(record, "id")
    ? parseNonBlankString(record.id, "$.id", "invalid-id", errors)
    : undefined;
  const name = Object.hasOwn(record, "name")
    ? parseNonBlankString(record.name, "$.name", "invalid-name", errors)
    : undefined;

  let holes: readonly CourseHole[] | undefined;
  if (Object.hasOwn(record, "holes")) {
    if (!Array.isArray(record.holes)) {
      addError(errors, "$.holes", "invalid-array", "Expected an ordered array of Holes.");
    } else {
      if (record.holes.length < 1 || record.holes.length > MAX_HOLES) {
        addError(
          errors,
          "$.holes",
          "invalid-hole-count",
          `A Course must contain between 1 and ${MAX_HOLES} Holes.`,
        );
      }
      const parsedHoles = record.holes.map((hole, index) => parseHole(hole, `$.holes[${index}]`, errors));
      const indexedHoles: IndexedHole[] = [];
      parsedHoles.forEach((hole, index) => {
        if (hole !== undefined) indexedHoles.push({ hole, index });
      });
      reportDuplicates(indexedHoles, errors);
      indexedHoles.forEach(({ hole, index }) => {
        validateHoleGeometry(hole, `$.holes[${index}]`, errors, warnings);
      });
      if (parsedHoles.every((hole): hole is CourseHole => hole !== undefined)) holes = parsedHoles;
    }
  }

  if (errors.length > 0 || schemaVersion === undefined || id === undefined
    || name === undefined || holes === undefined) {
    return { ok: false, errors, warnings };
  }
  return {
    ok: true,
    value: { schemaVersion, id, name, holes },
    errors: [],
    warnings,
  };
}

/** Alias emphasizing that successful validation also narrows unknown input. */
export const parseCourse = validateCourse;
