import { describe, expect, it } from "vitest";

import { validateCourse, type CourseValidationResult } from "./index.ts";

interface MutablePoint {
  x: number;
  y: number;
}

interface MutableShape {
  type: string;
  points?: MutablePoint[];
  center?: MutablePoint;
  radiusX?: number;
  radiusY?: number;
  width?: number;
}

interface MutableRegion {
  terrain: string;
  shape: MutableShape | undefined;
}

interface MutableHole {
  id: string;
  number: number;
  par: number;
  boundary: { type: string; points: MutablePoint[] };
  tee: MutablePoint;
  cup: MutablePoint;
  regions: MutableRegion[];
}

function makeHole(number = 1): MutableHole {
  return {
    id: `hole-${number}`,
    number,
    par: 4,
    boundary: {
      type: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 6 },
        { x: 0, y: 6 },
      ],
    },
    tee: { x: 0.5, y: 0.5 },
    cup: { x: 5.5, y: 5.5 },
    regions: [
      {
        terrain: "green",
        shape: {
          type: "ellipse",
          center: { x: 5.5, y: 5.5 },
          radiusX: 0.6,
          radiusY: 0.6,
        },
      },
    ],
  };
}

function makeCourse(holes: MutableHole[] = [makeHole()]) {
  return {
    schemaVersion: 1,
    id: "test-course",
    name: "Test Course",
    holes,
  };
}

function expectInvalid(input: unknown): Extract<CourseValidationResult, { ok: false }> {
  const result = validateCourse(input);
  if (result.ok) throw new Error("Expected Course validation to fail.");
  return result;
}

function errorPaths(input: unknown): string[] {
  return expectInvalid(input).errors.map((error) => error.path);
}

describe("version 1 Course structure", () => {
  it("accepts one and eighteen ordered Holes without reordering", () => {
    const one = validateCourse(makeCourse());
    expect(one.ok).toBe(true);

    const holes = Array.from({ length: 18 }, (_, index) => makeHole(index + 1));
    const eighteen = validateCourse(makeCourse(holes));
    expect(eighteen.ok).toBe(true);
    if (eighteen.ok) expect(eighteen.value.holes.map((hole) => hole.number)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    );
  });

  it("requires exactly schema version 1 and all Course fields", () => {
    const input = { schemaVersion: 2, id: "", holes: [] };
    const result = expectInvalid(input);
    expect(result.errors.map(({ path, code }) => ({ path, code }))).toEqual(expect.arrayContaining([
      { path: "$.schemaVersion", code: "invalid-schema-version" },
      { path: "$.id", code: "invalid-id" },
      { path: "$.name", code: "missing-property" },
      { path: "$.holes", code: "invalid-hole-count" },
    ]));
  });

  it("rejects zero and more than eighteen Holes", () => {
    expect(errorPaths(makeCourse([]))).toContain("$.holes");
    const nineteen = Array.from({ length: 19 }, (_, index) => makeHole((index % 18) + 1));
    expect(errorPaths(makeCourse(nineteen))).toContain("$.holes");
  });

  it("rejects sparse Hole, region, and point arrays at their missing indexes", () => {
    const sparseHoles = new Array<MutableHole>(1);

    const sparseRegionsHole = makeHole();
    const green = sparseRegionsHole.regions[0];
    if (green === undefined) throw new Error("Missing Green fixture.");
    sparseRegionsHole.regions = new Array<MutableRegion>(2);
    sparseRegionsHole.regions[1] = green;

    const sparseBoundaryHole = makeHole();
    delete sparseBoundaryHole.boundary.points[1];

    const sparseCorridorHole = makeHole();
    const corridorPoints = new Array<MutablePoint>(2);
    corridorPoints[0] = { x: 1, y: 1 };
    sparseCorridorHole.regions.unshift({
      terrain: "fairway",
      shape: { type: "corridor", points: corridorPoints, width: 1 },
    });

    const cases = [
      { input: makeCourse(sparseHoles), path: "$.holes[0]" },
      { input: makeCourse([sparseRegionsHole]), path: "$.holes[0].regions[0]" },
      { input: makeCourse([sparseBoundaryHole]), path: "$.holes[0].boundary.points[1]" },
      { input: makeCourse([sparseCorridorHole]), path: "$.holes[0].regions[0].shape.points[1]" },
    ];

    for (const testCase of cases) {
      expect(expectInvalid(testCase.input).errors).toEqual([
        expect.objectContaining({ path: testCase.path, code: "invalid-array" }),
      ]);
    }
  });

  it("rejects Hole name, declared length, and every other unknown field", () => {
    const hole = { ...makeHole(), name: "Forbidden", length: 5 };
    const result = expectInvalid(makeCourse([hole]));
    expect(result.errors.map((error) => error.path)).toEqual(expect.arrayContaining([
      "$.holes[0].name",
      "$.holes[0].length",
    ]));
    expect(result.errors.every((error) => error.code === "additional-property")).toBe(true);
  });

  it("models all shape and Terrain variants from unknown input", () => {
    const hole = makeHole();
    hole.regions = [
      {
        terrain: "rough",
        shape: {
          type: "polygon",
          points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }],
        },
      },
      {
        terrain: "fairway",
        shape: {
          type: "corridor",
          points: [{ x: 0.5, y: 0.5 }, { x: 4.5, y: 4.5 }],
          width: 1,
        },
      },
      {
        terrain: "bunker",
        shape: {
          type: "ellipse",
          center: { x: 3.5, y: 1.5 },
          radiusX: 0.6,
          radiusY: 0.6,
        },
      },
      {
        terrain: "water",
        shape: {
          type: "polygon",
          points: [{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 2, y: 5 }, { x: 1, y: 5 }],
        },
      },
      {
        terrain: "green",
        shape: {
          type: "ellipse",
          center: { x: 5.5, y: 5.5 },
          radiusX: 0.6,
          radiusY: 0.6,
        },
      },
    ];
    const result = validateCourse(makeCourse([hole]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.holes[0]?.regions.map((region) => region.terrain)).toEqual([
        "rough", "fairway", "bunker", "water", "green",
      ]);
      expect(result.value.holes[0]?.regions.map((region) => region.shape.type)).toEqual([
        "polygon", "corridor", "ellipse", "polygon", "ellipse",
      ]);
    }
  });
});

describe("blocking Course validation", () => {
  it("reports duplicate and invalid Hole IDs and numbers with paths", () => {
    const first = makeHole(1);
    const second = makeHole(1);
    const duplicate = expectInvalid(makeCourse([first, second]));
    expect(duplicate.errors.map(({ path, code }) => ({ path, code }))).toEqual(expect.arrayContaining([
      { path: "$.holes[1].id", code: "duplicate-hole-id" },
      { path: "$.holes[1].number", code: "duplicate-hole-number" },
    ]));

    const invalid = makeHole();
    invalid.id = "   ";
    invalid.number = 19;
    expect(errorPaths(makeCourse([invalid]))).toEqual(expect.arrayContaining([
      "$.holes[0].id", "$.holes[0].number",
    ]));
  });

  it("keeps duplicate and geometry checks when an independent Hole field is invalid", () => {
    const partial = makeHole(1);
    partial.par = 6;
    partial.boundary.points = [
      { x: 0, y: 0 }, { x: 513, y: 0 }, { x: 513, y: 6 }, { x: 0, y: 6 },
    ];
    const duplicate = makeHole(1);

    const result = expectInvalid(makeCourse([partial, duplicate]));
    expect(result.errors.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: "$.holes[0].par", code: "invalid-par" },
      { path: "$.holes[1].id", code: "duplicate-hole-id" },
      { path: "$.holes[1].number", code: "duplicate-hole-number" },
      { path: "$.holes[0].boundary", code: "boundary-too-large" },
    ]);
  });

  it("runs every available placement check on a partially parsed Hole", () => {
    const partial = makeHole();
    partial.id = " ";
    partial.tee = { x: -1, y: 1 };
    partial.regions = [];

    const result = expectInvalid(makeCourse([partial]));
    expect(result.errors.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: "$.holes[0].id", code: "invalid-id" },
      { path: "$.holes[0].tee", code: "point-outside-boundary" },
      { path: "$.holes[0].cup", code: "cup-not-green" },
    ]);
  });

  it("rejects invalid par and every non-finite coordinate", () => {
    const hole = { ...makeHole(), par: 6 };
    hole.tee = { x: Number.POSITIVE_INFINITY, y: Number.NaN };
    const result = expectInvalid(makeCourse([hole]));
    expect(result.errors.map(({ path, code }) => ({ path, code }))).toEqual(expect.arrayContaining([
      { path: "$.holes[0].par", code: "invalid-par" },
      { path: "$.holes[0].tee.x", code: "invalid-coordinate" },
      { path: "$.holes[0].tee.y", code: "invalid-coordinate" },
    ]));
  });

  it("rejects short, degenerate, and self-intersecting polygons without repair", () => {
    const malformedPolygons = [
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }],
      [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }],
    ];
    for (const points of malformedPolygons) {
      const hole = makeHole();
      hole.boundary.points = points;
      const result = expectInvalid(makeCourse([hole]));
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "$.holes[0].boundary", code: "invalid-polygon" }),
      ]));
      expect(hole.boundary.points).toBe(points);
    }
  });

  it("rejects non-positive ellipse radii and corridor widths or polylines", () => {
    const hole = makeHole();
    hole.regions = [
      {
        terrain: "fairway",
        shape: { type: "ellipse", center: { x: 2, y: 2 }, radiusX: 0, radiusY: -1 },
      },
      {
        terrain: "green",
        shape: {
          type: "corridor",
          points: [{ x: 4.5, y: 5.5 }, { x: 5.5, y: 5.5 }],
          width: 0,
        },
      },
      {
        terrain: "green",
        shape: { type: "corridor", points: [{ x: 5.5, y: 5.5 }], width: 1 },
      },
    ];
    const result = expectInvalid(makeCourse([hole]));
    expect(result.errors.map((error) => error.path)).toEqual(expect.arrayContaining([
      "$.holes[0].regions[0].shape.radiusX",
      "$.holes[0].regions[0].shape.radiusY",
      "$.holes[0].regions[1].shape.width",
      "$.holes[0].regions[2].shape",
    ]));
  });

  it("accepts a 512 × 512 Boundary and rejects either larger dimension", () => {
    const exact = makeHole();
    exact.boundary.points = [
      { x: 0, y: 0 }, { x: 512, y: 0 }, { x: 512, y: 512 }, { x: 0, y: 512 },
    ];
    expect(validateCourse(makeCourse([exact])).ok).toBe(true);

    const tooWide = makeHole();
    tooWide.boundary.points = [
      { x: 0, y: 0 }, { x: 512.1, y: 0 }, { x: 512.1, y: 2 }, { x: 0, y: 2 },
    ];
    expect(expectInvalid(makeCourse([tooWide])).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "$.holes[0].boundary", code: "boundary-too-large" }),
    ]));
  });

  it("rejects Tee or Cup outside the Course Boundary", () => {
    const hole = makeHole();
    hole.tee = { x: -0.1, y: 1 };
    hole.cup = { x: 7, y: 7 };
    const result = expectInvalid(makeCourse([hole]));
    expect(result.errors.map(({ path, code }) => ({ path, code }))).toEqual(expect.arrayContaining([
      { path: "$.holes[0].tee", code: "point-outside-boundary" },
      { path: "$.holes[0].cup", code: "point-outside-boundary" },
    ]));
  });

  it("rejects Tee/Cup hazards and requires Cup to resolve to Green after layering", () => {
    const hole = makeHole();
    hole.regions = [
      ...hole.regions,
      {
        terrain: "water",
        shape: { type: "ellipse", center: hole.tee, radiusX: 0.6, radiusY: 0.6 },
      },
      {
        terrain: "bunker",
        shape: { type: "ellipse", center: hole.cup, radiusX: 0.6, radiusY: 0.6 },
      },
    ];
    const result = expectInvalid(makeCourse([hole]));
    expect(result.errors.map(({ path, code }) => ({ path, code }))).toEqual(expect.arrayContaining([
      { path: "$.holes[0].tee", code: "point-on-hazard" },
      { path: "$.holes[0].cup", code: "point-on-hazard" },
      { path: "$.holes[0].cup", code: "cup-not-green" },
    ]));
  });

  it("rejects unsupported Terrain and shape types with exact JSON paths", () => {
    const hole = makeHole();
    hole.regions = [
      { terrain: "lava", shape: hole.regions[0]?.shape },
      { terrain: "green", shape: { type: "rectangle", width: 1 } },
    ];
    const result = expectInvalid(makeCourse([hole]));
    expect(result.errors.map(({ path, code }) => ({ path, code }))).toEqual(expect.arrayContaining([
      { path: "$.holes[0].regions[0].terrain", code: "unsupported-terrain" },
      { path: "$.holes[0].regions[1].shape.type", code: "unsupported-shape" },
    ]));
  });

  it("returns all independently discovered failures rather than stopping early", () => {
    const result = expectInvalid({
      schemaVersion: 9,
      id: "",
      name: " ",
      holes: [{ id: "", number: 0, par: 8 }],
      extra: true,
    });
    expect(result.errors.length).toBeGreaterThanOrEqual(10);
    expect(result.errors.map((error) => error.path)).toEqual(expect.arrayContaining([
      "$.extra",
      "$.schemaVersion",
      "$.id",
      "$.name",
      "$.holes[0].id",
      "$.holes[0].number",
      "$.holes[0].par",
      "$.holes[0].boundary",
      "$.holes[0].tee",
      "$.holes[0].cup",
      "$.holes[0].regions",
    ]));
  });
});

describe("non-blocking Course warnings", () => {
  it("does not reject playable land disconnected by Water", () => {
    const hole = makeHole();
    hole.regions = [
      {
        terrain: "water",
        shape: {
          type: "polygon",
          points: [{ x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 6 }, { x: 2, y: 6 }],
        },
      },
      ...hole.regions,
    ];
    expect(validateCourse(makeCourse([hole])).ok).toBe(true);
  });

  it("warns, but remains valid, when a region cannot affect a sampled cell", () => {
    const hole = makeHole();
    hole.regions = [
      {
        terrain: "fairway",
        shape: {
          type: "corridor",
          points: [{ x: 0.1, y: 2.1 }, { x: 0.2, y: 2.1 }],
          width: 0.01,
        },
      },
      ...hole.regions,
    ];
    const result = validateCourse(makeCourse([hole]));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        path: "$.holes[0].regions[0]",
        code: "narrow-region",
      }),
    ]);
  });
});
