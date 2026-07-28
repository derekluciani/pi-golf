import { TERRAINS } from "../domain/index.ts";

export const COURSE_SCHEMA_VERSION = 1 as const;
export const COURSE_REQUIRED_PROPERTIES = ["schemaVersion", "id", "name", "holes"] as const;
export const HOLE_REQUIRED_PROPERTIES = [
  "id",
  "number",
  "par",
  "boundary",
  "tee",
  "cup",
  "regions",
] as const;
export const REGION_REQUIRED_PROPERTIES = ["terrain", "shape"] as const;
export const SHAPE_TYPES = ["polygon", "ellipse", "corridor"] as const;
export const MAX_HOLES = 18;
export const MAX_REGIONS_PER_HOLE = 128;
export const MAX_POINTS_PER_SHAPE = 1_024;
export const MAX_BOUNDARY_EXTENT = 512;
export const MAX_TOTAL_RASTER_CELLS = 2_000_000;
export const MAX_COURSE_JSON_BYTES = 1_048_576;
export const MAX_COURSE_DIAGNOSTICS = 256;
export const COURSE_ID_PATTERN = "^[a-z0-9](?:[a-z0-9._-]{0,63})$";
export const COURSE_NAME_PATTERN = "^(?!\\s)(?!.*\\s$)[^\\u0000-\\u001f\\u007f]{1,30}$";
/** Inclusive magnitude limit for every coordinate and upper limit for positive dimensions. */
export const MAX_GEOMETRY_MAGNITUDE = 1_000_000;

const coordinateSchema = {
  type: "number",
  minimum: -MAX_GEOMETRY_MAGNITUDE,
  maximum: MAX_GEOMETRY_MAGNITUDE,
} as const;

const positiveDimensionSchema = {
  type: "number",
  exclusiveMinimum: 0,
  maximum: MAX_GEOMETRY_MAGNITUDE,
} as const;

/**
 * Authoritative structural schema for Course JSON. Geometry and cross-field
 * constraints are enforced by the path-aware semantic validator.
 */
export const COURSE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/derekluciani/pi-golf/blob/main/.pi/extensions/golf/course-loader/course.schema.json",
  title: "Pi Golf Course version 1",
  type: "object",
  additionalProperties: false,
  required: COURSE_REQUIRED_PROPERTIES,
  properties: {
    schemaVersion: { const: COURSE_SCHEMA_VERSION },
    id: { type: "string", minLength: 1, maxLength: 64, pattern: COURSE_ID_PATTERN },
    name: { type: "string", minLength: 1, maxLength: 30, pattern: COURSE_NAME_PATTERN },
    holes: {
      type: "array",
      minItems: 1,
      maxItems: MAX_HOLES,
      items: { $ref: "#/$defs/hole" },
    },
  },
  $defs: {
    point: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: {
        x: coordinateSchema,
        y: coordinateSchema,
      },
    },
    polygon: {
      type: "object",
      additionalProperties: false,
      required: ["type", "points"],
      properties: {
        type: { const: "polygon" },
        points: {
          type: "array",
          minItems: 3,
          maxItems: MAX_POINTS_PER_SHAPE,
          items: { $ref: "#/$defs/point" },
        },
      },
    },
    ellipse: {
      type: "object",
      additionalProperties: false,
      required: ["type", "center", "radiusX", "radiusY"],
      properties: {
        type: { const: "ellipse" },
        center: { $ref: "#/$defs/point" },
        radiusX: positiveDimensionSchema,
        radiusY: positiveDimensionSchema,
      },
    },
    corridor: {
      type: "object",
      additionalProperties: false,
      required: ["type", "points", "width"],
      properties: {
        type: { const: "corridor" },
        points: {
          type: "array",
          minItems: 2,
          maxItems: MAX_POINTS_PER_SHAPE,
          items: { $ref: "#/$defs/point" },
        },
        width: positiveDimensionSchema,
      },
    },
    region: {
      type: "object",
      additionalProperties: false,
      required: REGION_REQUIRED_PROPERTIES,
      properties: {
        terrain: { enum: TERRAINS },
        shape: {
          oneOf: [
            { $ref: "#/$defs/polygon" },
            { $ref: "#/$defs/ellipse" },
            { $ref: "#/$defs/corridor" },
          ],
        },
      },
    },
    hole: {
      type: "object",
      additionalProperties: false,
      required: HOLE_REQUIRED_PROPERTIES,
      properties: {
        id: { type: "string", minLength: 1, maxLength: 64, pattern: COURSE_ID_PATTERN },
        number: { type: "integer", minimum: 1, maximum: 18 },
        par: { type: "integer", minimum: 3, maximum: 5 },
        boundary: { $ref: "#/$defs/polygon" },
        tee: { $ref: "#/$defs/point" },
        cup: { $ref: "#/$defs/point" },
        regions: {
          type: "array",
          maxItems: MAX_REGIONS_PER_HOLE,
          items: { $ref: "#/$defs/region" },
        },
      },
    },
  },
} as const;
