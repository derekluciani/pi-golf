import { readFile } from "node:fs/promises";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { COURSE_SCHEMA } from "./schema.ts";
import { validateCourse } from "./validation.ts";

type PathSegment = string | number;

function validCourse(): unknown {
  return {
    schemaVersion: 1,
    id: "schema-course",
    name: "Schema Course",
    holes: [{
      id: "schema-hole",
      number: 1,
      par: 4,
      boundary: {
        type: "polygon",
        points: [
          { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 },
        ],
      },
      tee: { x: 0.5, y: 0.5 },
      cup: { x: 5.5, y: 5.5 },
      regions: [{
        terrain: "green",
        shape: {
          type: "ellipse",
          center: { x: 5.5, y: 5.5 },
          radiusX: 0.6,
          radiusY: 0.6,
        },
      }],
    }],
  };
}

function objectAtPath(root: unknown, path: readonly PathSegment[]): Record<string, unknown> | unknown[] {
  let current = root;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") current = current[segment];
    else if (typeof current === "object" && current !== null && typeof segment === "string") {
      current = (current as Record<string, unknown>)[segment];
    } else throw new Error(`Invalid fixture path: ${path.join(".")}`);
  }
  if (typeof current !== "object" || current === null) {
    throw new Error(`Fixture path is not an object or array: ${path.join(".")}`);
  }
  return current as Record<string, unknown> | unknown[];
}

function replaceAtPath(path: readonly PathSegment[], value: unknown): unknown {
  const clone = structuredClone(validCourse());
  const parentPath = path.slice(0, -1);
  const property = path.at(-1);
  const parent = objectAtPath(clone, parentPath);
  if (property === undefined) return value;
  if (Array.isArray(parent) && typeof property === "number") parent[property] = value;
  else if (!Array.isArray(parent) && typeof property === "string") parent[property] = value;
  else throw new Error(`Invalid fixture replacement path: ${path.join(".")}`);
  return clone;
}

function removeAtPath(path: readonly PathSegment[]): unknown {
  const clone = structuredClone(validCourse());
  const property = path.at(-1);
  const parent = objectAtPath(clone, path.slice(0, -1));
  if (Array.isArray(parent) && typeof property === "number") Reflect.deleteProperty(parent, property);
  else if (!Array.isArray(parent) && typeof property === "string") {
    Reflect.deleteProperty(parent, property);
  }
  else throw new Error(`Invalid fixture removal path: ${path.join(".")}`);
  return clone;
}

function withAdditionalProperty(path: readonly PathSegment[], property: string): unknown {
  const clone = structuredClone(validCourse());
  const target = objectAtPath(clone, path);
  if (Array.isArray(target)) throw new Error("Expected an object fixture target.");
  target[property] = true;
  return clone;
}

describe("Course author schema", () => {
  it("is exactly equal to the checked-in machine-readable schema", async () => {
    const schemaUrl = new URL("./course.schema.json", import.meta.url);
    const staticSchema: unknown = JSON.parse(await readFile(schemaUrl, "utf8"));
    expect(staticSchema).toEqual(COURSE_SCHEMA);
  });

  it("has exact runtime acceptance for a complete structural mutation matrix", async () => {
    const schemaUrl = new URL("./course.schema.json", import.meta.url);
    const staticSchema: object = JSON.parse(await readFile(schemaUrl, "utf8")) as object;
    const validateStaticSchema = new Ajv2020({ allErrors: true, strict: true }).compile(staticSchema);
    const allRegions = [
      {
        terrain: "rough",
        shape: { type: "polygon", points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }] },
      },
      {
        terrain: "fairway",
        shape: { type: "corridor", points: [{ x: 1, y: 3 }, { x: 2, y: 3 }], width: 0.2 },
      },
      {
        terrain: "bunker",
        shape: { type: "ellipse", center: { x: 3, y: 1 }, radiusX: 0.2, radiusY: 0.2 },
      },
      {
        terrain: "water",
        shape: { type: "polygon", points: [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 4 }] },
      },
      {
        terrain: "green",
        shape: { type: "ellipse", center: { x: 5.5, y: 5.5 }, radiusX: 0.6, radiusY: 0.6 },
      },
    ];
    const sparseHoles = new Array(1);
    const sparseRegions = new Array(2);
    sparseRegions[1] = allRegions[4];
    const sparsePoints = new Array(3);
    sparsePoints[0] = { x: 0, y: 0 };
    sparsePoints[2] = { x: 0, y: 6 };

    const cases: readonly { readonly name: string; readonly input: unknown }[] = [
      { name: "valid baseline", input: validCourse() },
      { name: "all Terrain and shape variants", input: replaceAtPath(["holes", 0, "regions"], allRegions) },
      ...["schemaVersion", "id", "name", "holes"].map((property) => ({
        name: `missing Course ${property}`,
        input: removeAtPath([property]),
      })),
      { name: "additional Course property", input: withAdditionalProperty([], "extra") },
      { name: "unsupported schema version", input: replaceAtPath(["schemaVersion"], 2) },
      { name: "blank Course ID", input: replaceAtPath(["id"], " ") },
      { name: "non-string Course name", input: replaceAtPath(["name"], 3) },
      { name: "non-array Holes", input: replaceAtPath(["holes"], {}) },
      { name: "empty Holes", input: replaceAtPath(["holes"], []) },
      { name: "nineteen Holes", input: replaceAtPath(["holes"], Array.from({ length: 19 }, () => objectAtPath(structuredClone(validCourse()), ["holes", 0]))) },
      { name: "sparse Holes", input: replaceAtPath(["holes"], sparseHoles) },
      ...["id", "number", "par", "boundary", "tee", "cup", "regions"].map((property) => ({
        name: `missing Hole ${property}`,
        input: removeAtPath(["holes", 0, property]),
      })),
      { name: "additional Hole property", input: withAdditionalProperty(["holes", 0], "name") },
      { name: "blank Hole ID", input: replaceAtPath(["holes", 0, "id"], "") },
      { name: "Hole number below range", input: replaceAtPath(["holes", 0, "number"], 0) },
      { name: "fractional Hole number", input: replaceAtPath(["holes", 0, "number"], 1.5) },
      { name: "Hole number above range", input: replaceAtPath(["holes", 0, "number"], 19) },
      { name: "par below range", input: replaceAtPath(["holes", 0, "par"], 2) },
      { name: "fractional par", input: replaceAtPath(["holes", 0, "par"], 3.5) },
      { name: "par above range", input: replaceAtPath(["holes", 0, "par"], 6) },
      { name: "non-object point", input: replaceAtPath(["holes", 0, "tee"], []) },
      { name: "missing point x", input: removeAtPath(["holes", 0, "tee", "x"]) },
      { name: "additional point property", input: withAdditionalProperty(["holes", 0, "tee"], "z") },
      { name: "non-number coordinate", input: replaceAtPath(["holes", 0, "tee", "x"], "0") },
      { name: "non-finite coordinate", input: replaceAtPath(["holes", 0, "tee", "x"], Number.POSITIVE_INFINITY) },
      { name: "non-object Boundary", input: replaceAtPath(["holes", 0, "boundary"], []) },
      { name: "missing polygon type", input: removeAtPath(["holes", 0, "boundary", "type"]) },
      { name: "missing polygon points", input: removeAtPath(["holes", 0, "boundary", "points"]) },
      { name: "additional polygon property", input: withAdditionalProperty(["holes", 0, "boundary"], "width") },
      { name: "wrong polygon type", input: replaceAtPath(["holes", 0, "boundary", "type"], "ellipse") },
      { name: "short polygon points", input: replaceAtPath(["holes", 0, "boundary", "points"], [{ x: 0, y: 0 }, { x: 1, y: 0 }]) },
      { name: "sparse polygon points", input: replaceAtPath(["holes", 0, "boundary", "points"], sparsePoints) },
      { name: "non-array regions", input: replaceAtPath(["holes", 0, "regions"], {}) },
      { name: "sparse regions", input: replaceAtPath(["holes", 0, "regions"], sparseRegions) },
      { name: "missing region Terrain", input: removeAtPath(["holes", 0, "regions", 0, "terrain"]) },
      { name: "missing region shape", input: removeAtPath(["holes", 0, "regions", 0, "shape"]) },
      { name: "additional region property", input: withAdditionalProperty(["holes", 0, "regions", 0], "extra") },
      { name: "unsupported Terrain", input: replaceAtPath(["holes", 0, "regions", 0, "terrain"], "lava") },
      { name: "non-object shape", input: replaceAtPath(["holes", 0, "regions", 0, "shape"], []) },
      { name: "unsupported shape", input: replaceAtPath(["holes", 0, "regions", 0, "shape", "type"], "rectangle") },
      { name: "missing ellipse center", input: removeAtPath(["holes", 0, "regions", 0, "shape", "center"]) },
      { name: "missing ellipse radiusX", input: removeAtPath(["holes", 0, "regions", 0, "shape", "radiusX"]) },
      { name: "missing ellipse radiusY", input: removeAtPath(["holes", 0, "regions", 0, "shape", "radiusY"]) },
      { name: "additional ellipse property", input: withAdditionalProperty(["holes", 0, "regions", 0, "shape"], "width") },
      { name: "zero ellipse radius", input: replaceAtPath(["holes", 0, "regions", 0, "shape", "radiusX"], 0) },
      { name: "non-number ellipse radius", input: replaceAtPath(["holes", 0, "regions", 0, "shape", "radiusY"], "1") },
      { name: "valid corridor", input: replaceAtPath(["holes", 0, "regions"], [allRegions[1], allRegions[4]]) },
      { name: "corridor missing points", input: replaceAtPath(["holes", 0, "regions", 0, "shape"], { type: "corridor", width: 1 }) },
      { name: "corridor missing width", input: replaceAtPath(["holes", 0, "regions", 0, "shape"], { type: "corridor", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }) },
      { name: "corridor with short polyline", input: replaceAtPath(["holes", 0, "regions", 0, "shape"], { type: "corridor", points: [{ x: 1, y: 1 }], width: 1 }) },
      { name: "corridor with zero width", input: replaceAtPath(["holes", 0, "regions", 0, "shape"], { type: "corridor", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], width: 0 }) },
      { name: "corridor with additional property", input: replaceAtPath(["holes", 0, "regions", 0, "shape"], { type: "corridor", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], width: 1, radius: 1 }) },
      { name: "valid polygon region", input: replaceAtPath(["holes", 0, "regions"], [allRegions[0], allRegions[4]]) },
      { name: "polygon region with short points", input: replaceAtPath(["holes", 0, "regions", 0, "shape"], { type: "polygon", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }) },
    ];

    const acceptedCases = new Set([
      "valid baseline",
      "all Terrain and shape variants",
      "valid corridor",
      "valid polygon region",
    ]);
    for (const testCase of cases) {
      const expected = acceptedCases.has(testCase.name);
      const schemaAccepted = validateStaticSchema(testCase.input);
      const runtimeResult = validateCourse(testCase.input);
      expect(schemaAccepted, `${testCase.name}: static schema result`).toBe(expected);
      expect(
        runtimeResult.ok,
        `${testCase.name}: runtime errors=${JSON.stringify(runtimeResult.errors)}`,
      ).toBe(expected);
    }
  });

  it("forbids Hole name and declared Length fields", () => {
    expect(COURSE_SCHEMA.$defs.hole.additionalProperties).toBe(false);
    expect(Object.keys(COURSE_SCHEMA.$defs.hole.properties)).toEqual([
      "id", "number", "par", "boundary", "tee", "cup", "regions",
    ]);
  });
});
