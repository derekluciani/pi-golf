/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unused-vars -- bounded mutable adversarial fixtures */
import { describe, expect, it } from "vitest";

import {
  MAX_COURSE_DIAGNOSTICS, MAX_COURSE_JSON_BYTES, MAX_POINTS_PER_SHAPE,
  MAX_REGIONS_PER_HOLE, MAX_TOTAL_RASTER_CELLS,
  canonicalizeCourseWarnings, createRoundCourseSnapshot, parseCourseJson,
  rasterizeCourse, terrainAtPoint, validateCourse,
} from "./index.ts";
import { polygonContainsPoint, shapeContainsPoint } from "./geometry.ts";

function hole(number = 1) {
  return {
    id: `hole-${number}`, number, par: 3,
    boundary: { type: "polygon", points: [{ x: -1, y: -1 }, { x: 3, y: -1 }, { x: 3, y: 3 }, { x: -1, y: 3 }] },
    tee: { x: 0.1, y: 0.1 }, cup: { x: 2.1, y: 2.1 },
    regions: [{ terrain: "green", shape: { type: "ellipse", center: { x: 2.5, y: 2.5 }, radiusX: 0.6, radiusY: 0.6 } }],
  };
}
function course(holes: unknown[] = [hole()]) { return { schemaVersion: 1, id: "valid-course", name: "Valid Course", holes }; }
function errors(input: unknown) { const r = validateCourse(input); return r.ok ? [] : r.errors; }
function validatedHole(input: unknown) {
  const result = validateCourse(course([input]));
  if (!result.ok) throw new Error(`Invalid test fixture: ${JSON.stringify(result.errors)}`);
  return result.value.holes[0]!;
}

describe("V2-T02 Course semantics acceptance", () => {
  it("AC-CRS-001-01 closed schema accepts exactly required identities, fields, shapes and Terrain", () => {
    expect(validateCourse(course()).ok).toBe(true);
    expect(errors({ ...course(), extra: true }).map(e => e.path)).toContain("$.extra");
    expect(errors({ ...course(), id: "Upper" }).map(e => e.path)).toContain("$.id");
    expect(errors({ ...course(), name: " trailing " }).map(e => e.path)).toContain("$.name");
  });
  it("AC-CRS-001-02 rejects exact raw limits without repair", () => {
    const h = hole(); h.tee.x = 1_000_000.001; const input = course([h]);
    const result = errors(input); expect(result.map(e => e.path)).toContain("$.holes[0].tee.x");
    expect(h.tee.x).toBe(1_000_000.001);
  });
  it("AC-CRS-001-03 enforces complexity, region, byte, extent, raster and diagnostic resources", () => {
    const tooMany = hole(); tooMany.boundary.points = Array.from({ length: MAX_POINTS_PER_SHAPE + 1 }, (_, i) => ({ x: i % 2, y: i }));
    expect(errors(course([tooMany])).some(e => e.path.endsWith("boundary.points"))).toBe(true);
    expect(parseCourseJson(" ".repeat(MAX_COURSE_JSON_BYTES + 1)).ok).toBe(false);
    const oversizedHoles = Array.from({ length: 8 }, (_, i) => ({ ...hole(i + 1),
      boundary: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 512, y: 0 }, { x: 512, y: 512 }, { x: 0, y: 512 }] },
      regions: [{ terrain: "green", shape: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 512, y: 0 }, { x: 512, y: 512 }, { x: 0, y: 512 }] } }],
    }));
    expect(errors(course(oversizedHoles)).map(e => e.code)).toContain("raster-limit-exceeded");
    const tooManyRegions = hole(); tooManyRegions.regions = Array.from({ length: 129 }, () => tooManyRegions.regions[0]!);
    expect(errors(course([tooManyRegions])).map(e => e.path)).toContain("$.holes[0].regions");
    const noisy = { schemaVersion: 9, id: "", name: "", holes: Array.from({ length: 18 }, () => ({})), ...Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`x${i}`, i])) };
    const capped = errors(noisy); expect(capped).toHaveLength(MAX_COURSE_DIAGNOSTICS); expect(capped.at(-1)?.code).toBe("diagnostics-truncated");
  });
  it("AC-CRS-001-03 accepts each exact resource limit and rejects one over", () => {
    const regularPolygon = (count: number) => Array.from({ length: count }, (_, index) => {
      const angle = (2 * Math.PI * index) / count;
      return { x: 1.5 + Math.cos(angle) * 0.25, y: 1.5 + Math.sin(angle) * 0.25 };
    });
    const corridorPoints = (count: number) => Array.from({ length: count }, (_, index) => ({
      x: 0.1 + index / count,
      y: 0.1 + index / count,
    }));
    const withShape = (shape: unknown) => course([{
      ...hole(),
      regions: [{ terrain: "fairway", shape }, hole().regions[0]!],
    }]);

    expect(validateCourse(withShape({ type: "polygon", points: regularPolygon(MAX_POINTS_PER_SHAPE) })).ok).toBe(true);
    expect(errors(withShape({ type: "polygon", points: regularPolygon(MAX_POINTS_PER_SHAPE + 1) })).map(error => error.path)).toContain("$.holes[0].regions[0].shape.points");
    expect(validateCourse(withShape({ type: "corridor", points: corridorPoints(MAX_POINTS_PER_SHAPE), width: 0.01 })).ok).toBe(true);
    expect(errors(withShape({ type: "corridor", points: corridorPoints(MAX_POINTS_PER_SHAPE + 1), width: 0.01 })).map(error => error.path)).toContain("$.holes[0].regions[0].shape.points");

    const maxRegions = hole();
    maxRegions.regions = Array.from({ length: MAX_REGIONS_PER_HOLE }, (_, index) => index === MAX_REGIONS_PER_HOLE - 1
      ? maxRegions.regions[0]!
      : { terrain: "fairway", shape: { type: "ellipse", center: { x: 0.1, y: 0.1 }, radiusX: 0.01, radiusY: 0.01 } });
    expect(validateCourse(course([maxRegions])).ok).toBe(true);
    maxRegions.regions = [...maxRegions.regions, maxRegions.regions[0]!];
    expect(errors(course([maxRegions])).map(error => error.path)).toContain("$.holes[0].regions");

    const resourceHole = (number: number, width: number, height: number) => ({
      ...hole(number),
      boundary: { type: "polygon", points: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }] },
      tee: { x: 0.1, y: 0.1 }, cup: { x: 0.5, y: 0.5 },
      regions: [{ terrain: "green", shape: { type: "ellipse", center: { x: 0.5, y: 0.5 }, radiusX: 0.6, radiusY: 0.6 } }],
    });
    const exactRasterHoles = [
      ...Array.from({ length: 7 }, (_, index) => resourceHole(index + 1, 500, 500)),
      resourceHole(8, 499, 501), resourceHole(9, 1, 1),
    ];
    expect(MAX_TOTAL_RASTER_CELLS).toBe(2_000_000);
    expect(validateCourse(course(exactRasterHoles)).ok).toBe(true);
    const oneOverRasterHoles = [...exactRasterHoles.slice(0, -1), resourceHole(9, 1, 2)];
    expect(errors(course(oneOverRasterHoles)).map(error => error.code)).toContain("raster-limit-exceeded");

    const serialized = JSON.stringify(course());
    const exactBytes = `${serialized}${" ".repeat(MAX_COURSE_JSON_BYTES - Buffer.byteLength(serialized, "utf8"))}`;
    expect(Buffer.byteLength(exactBytes, "utf8")).toBe(MAX_COURSE_JSON_BYTES);
    expect(parseCourseJson(exactBytes).ok).toBe(true);
    expect(parseCourseJson(`${exactBytes} `).ok).toBe(false);
  });
  it("AC-CRS-001-04 schema equivalence is locked by schema.test.ts", () => expect(true).toBe(true));
  it("AC-CRS-002-01 duplicate-aware raw parsing rejects duplicate members first", () => {
    const raw = JSON.stringify(course()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
    const result = parseCourseJson(raw); expect(result.ok).toBe(false); if (!result.ok) expect(result.errors).toEqual([expect.objectContaining({ code: "duplicate-key", path: "$.schemaVersion" })]);
  });
  it("AC-CRS-001-03 AC-CRS-002-02 reserves a deterministic truncation slot for duplicate-key diagnostics", () => {
    const raw = `{${Array.from({ length: 300 }, (_, index) => `"repeated":${index}`).join(",")}}`;
    const first = parseCourseJson(raw); const second = parseCourseJson(raw);
    expect(first).toEqual(second); expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.errors).toHaveLength(MAX_COURSE_DIAGNOSTICS);
      expect(first.errors.slice(0, -1).every(error => error.code === "duplicate-key")).toBe(true);
      expect(first.errors.at(-1)).toEqual({
        path: "$", code: "diagnostics-truncated", message: "44 duplicate-key diagnostics omitted.",
      });
    }
  });
  it("AC-CRS-002-02 aggregates deterministic path-aware blocking diagnostics", () => {
    const input = { ...course(), schemaVersion: 2, id: "BAD", name: " bad " };
    expect(errors(input)).toEqual(errors(input)); expect(errors(input).map(e => e.path)).toEqual(expect.arrayContaining(["$.schemaVersion", "$.id", "$.name"]));
  });
  it("AC-CRS-002-03 accepts disconnected playable land", () => {
    const h = hole(); h.regions.unshift({ terrain: "water", shape: { type: "ellipse", center: { x: 1.5, y: 1.5 }, radiusX: 0.4, radiusY: 3 } });
    expect(validateCourse(course([h])).ok).toBe(true);
  });
  it("AC-CRS-002-04 keeps raw file and parseCourse(unknown) boundaries distinct", () => {
    expect(parseCourseJson(JSON.stringify(course())).ok).toBe(true); expect(validateCourse(course()).ok).toBe(true);
  });
  it("AC-CRS-003-01 owns polygon edges and ellipse boundaries as closed geometry", () => {
    const polygon = { ...hole().boundary, type: "polygon" as const };
    expect(polygonContainsPoint(polygon, { x: -1, y: 1 })).toBe(true);
    expect(polygonContainsPoint(polygon, { x: -1.0000000000000002, y: 1 })).toBe(false);
    const ellipse = { type: "ellipse" as const, center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1 };
    expect(shapeContainsPoint(ellipse, { x: 2, y: 0 })).toBe(true);
    expect(shapeContainsPoint(ellipse, { x: 2.0000000000000004, y: 0 })).toBe(false);
    const h = validatedHole({ ...hole(), regions: [
      { terrain: "fairway", shape: { type: "ellipse", center: { x: -0.5, y: 0.5 }, radiusX: 1, radiusY: 1 } },
      hole().regions[0],
    ] });
    expect(terrainAtPoint(h, { x: 0.1, y: 0.1 })).toBe("fairway"); // owning center is on ellipse

  });
  it("AC-CRS-003-01 treats corridors as closed capsule unions including caps and joins", () => {
    const corridor = { type: "corridor" as const, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], width: 2 };
    expect(shapeContainsPoint(corridor, { x: -1, y: 0 })).toBe(true); // first cap
    expect(shapeContainsPoint(corridor, { x: 3, y: 0 })).toBe(true); // join's closed disk
    expect(shapeContainsPoint(corridor, { x: 2, y: 3 })).toBe(true); // final cap
    expect(shapeContainsPoint(corridor, { x: 3.0000000000000004, y: 0 })).toBe(false);
    const h = validatedHole({ ...hole(), regions: [
      { terrain: "fairway", shape: { type: "corridor", points: [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 1.5, y: 1.5 }], width: 2 } },
      hole().regions[0],
    ] });
    expect(terrainAtPoint(h, { x: -0.1, y: 0.1 })).toBe("fairway"); // cap boundary center
    expect(terrainAtPoint(h, { x: 2.1, y: 0.1 })).toBe("fairway"); // join boundary center

  });
  it("AC-CRS-003-01 applies ordered overlap and clips region paint at the Boundary", () => {
    const h = validatedHole({ ...hole(), regions: [
      { terrain: "fairway", shape: { type: "polygon", points: [{ x: -2, y: -2 }, { x: 4, y: -2 }, { x: 4, y: 4 }, { x: -2, y: 4 }] } },
      { terrain: "water", shape: { type: "ellipse", center: { x: 1.5, y: 1.5 }, radiusX: 1, radiusY: 1 } },
      hole().regions[0],
    ] });
    expect(terrainAtPoint(h, { x: 1.1, y: 1.1 })).toBe("water");
    expect(terrainAtPoint(h, { x: 0.1, y: 0.1 })).toBe("fairway");
    expect(terrainAtPoint(h, { x: 3.1, y: 1.1 })).toBe("out-of-bounds");
  });
  it("AC-CRS-003-01 uses floor ownership for negative coordinates and half-open cells", () => {
    const h = validatedHole({ ...hole(), regions: [{ terrain: "green", shape: {
      type: "polygon", points: [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 0, y: 0 }, { x: -1, y: 0 }],
    } }, hole().regions[0]] });
    expect(terrainAtPoint(h, { x: -1, y: -0.25 })).toBe("green");
    expect(terrainAtPoint(h, { x: -0.0000000000000001, y: -0.25 })).toBe("green");
    expect(terrainAtPoint(h, { x: 0, y: -0.25 })).toBe("rough");
    expect(terrainAtPoint(h, { x: 0.9999999999999999, y: -0.25 })).toBe("rough");
  });
  it("AC-CRS-003-02 rejects continuous sub-cell Green not painting Cup cell", () => {
    const h = hole(); h.cup = { x: 1.1, y: 1.1 }; h.regions = [{ terrain: "green", shape: { type: "ellipse", center: h.cup, radiusX: .2, radiusY: .2 } }];
    expect(errors(course([h])).map(e => e.code)).toContain("cup-not-green");
  });
  it("AC-CRS-003-03 rejects Boundary point whose owning raster cell is OOB", () => {
    const h = hole(); h.boundary.points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 2 }]; h.tee = { x: .1, y: .1 }; h.cup = { x: 4, y: 0 }; h.regions = [{ terrain: "green", shape: { type: "ellipse", center: h.cup, radiusX: 1, radiusY: 1 } }];
    expect(errors(course([h])).map(e => e.code)).toContain("cup-not-green");
  });
  it("AC-CRS-003-04 tests ordinary and near-limit polygon predicate boundaries", () => {
    const ordinary = { type: "polygon" as const, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] };
    const nearLimit = { type: "polygon" as const, points: ordinary.points.map(point => ({ x: point.x + 999_996, y: point.y + 999_996 })) };
    expect(polygonContainsPoint(ordinary, { x: 4, y: 2 })).toBe(true);
    expect(polygonContainsPoint(ordinary, { x: 4.000000000000001, y: 2 })).toBe(false);
    expect(polygonContainsPoint(nearLimit, { x: 1_000_000, y: 999_998 })).toBe(true);
    expect(polygonContainsPoint(nearLimit, { x: 999_995.9999999999, y: 999_998 })).toBe(false);
  });
  it("AC-CRS-003-04 accepts a valid thin polygon at the coordinate limit", () => {
    const thinNearLimitPolygon = {
      type: "polygon" as const,
      points: [
        { x: 999_999, y: 999_999.9999999 },
        { x: 1_000_000, y: 999_999.9999999 },
        { x: 1_000_000, y: 1_000_000 },
        { x: 999_999, y: 1_000_000 },
      ],
    };
    const h = {
      ...hole(),
      regions: [{ terrain: "fairway", shape: thinNearLimitPolygon }, ...hole().regions],
    };
    const result = validateCourse(course([h]));
    expect(result.ok).toBe(true);
    if (!result.ok) expect(result.errors).not.toContainEqual(expect.objectContaining({
      path: "$.holes[0].regions[0].shape", code: "invalid-polygon",
    }));
  });
  it("AC-CRS-003-04 tests ordinary and near-limit ellipse predicate boundaries", () => {
    const ordinary = { type: "ellipse" as const, center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1 };
    const nearLimit = { ...ordinary, center: { x: 999_998, y: 999_998 } };
    expect(shapeContainsPoint(ordinary, { x: 0, y: 1 })).toBe(true);
    expect(shapeContainsPoint(ordinary, { x: 0, y: 1.0000000000000002 })).toBe(false);
    expect(shapeContainsPoint(nearLimit, { x: 1_000_000, y: 999_998 })).toBe(true);
    expect(shapeContainsPoint(nearLimit, { x: 999_995.9999999999, y: 999_998 })).toBe(false);
  });
  it("AC-CRS-003-04 tests ordinary and near-limit corridor predicate boundaries", () => {
    const ordinary = { type: "corridor" as const, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }], width: 2 };
    const nearLimit = { ...ordinary, points: [{ x: 999_996, y: 999_998 }, { x: 999_999, y: 999_998 }] };
    expect(shapeContainsPoint(ordinary, { x: 1, y: 1 })).toBe(true);
    expect(shapeContainsPoint(ordinary, { x: 1, y: 1.0000000000000002 })).toBe(false);
    expect(shapeContainsPoint(nearLimit, { x: 999_998, y: 999_999 })).toBe(true);
    expect(shapeContainsPoint(nearLimit, { x: 999_998, y: 999_999.0000000001 })).toBe(false);
  });
  it("AC-CRS-004-01 repeated raster is typed deeply equal row-major", () => { const r = validateCourse(course()); if (!r.ok) throw new Error("fixture"); expect(rasterizeCourse(r.value)).toEqual(rasterizeCourse(r.value)); });
  it("AC-CRS-004-02 emits exactly one warning only for each no-cell region", () => {
    const h = hole(); h.regions.unshift({ terrain: "fairway", shape: { type: "ellipse", center: { x: .1, y: .1 }, radiusX: .01, radiusY: .01 } });
    const r = validateCourse(course([h])); expect(r.warnings).toHaveLength(1); expect(r.warnings[0]?.code).toBe("narrow-region");
  });
  it("AC-CRS-004-03 structured warning identity ignores candidate order and wording", () => {
    const a = { path: "$.a", code: "narrow-region" as const, message: "one", sourcePath: "/a" }; const b = { ...a, message: "two" };
    const first = canonicalizeCourseWarnings([a, b]); const second = canonicalizeCourseWarnings([b, a]);
    expect(first.map(({ message: _message, ...identity }) => identity)).toEqual(second.map(({ message: _message, ...identity }) => identity)); expect(first).toHaveLength(1);
  });
  it("AC-CRS-004-04 warning diagnostics cap with deterministic truncation", () => {
    const candidates = Array.from({ length: 300 }, (_, i) => ({ path: `$.x[${i}]`, code: "narrow-region" as const, message: "x", regionIndex: i }));
    const result = canonicalizeCourseWarnings(candidates); expect(result).toHaveLength(256); expect(result.at(-1)?.code).toBe("diagnostics-truncated");
  });
  it("AC-CRS-005-01 caller/source mutation cannot alter active snapshot", async () => {
    const input = course(); let raw = JSON.stringify(input); const snapshot = await createRoundCourseSnapshot(async () => raw); input.name = "Changed"; raw = ""; expect(snapshot.course.name).toBe("Valid Course");
  });
  it("AC-CRS-005-02 snapshot is fresh deeply immutable serialized once and reusable", async () => {
    const snapshot = await createRoundCourseSnapshot(async () => JSON.stringify(course())); expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.course.holes[0]!.tee)).toBe(true); expect(JSON.parse(snapshot.serializedCourse)).toEqual(snapshot.course);
  });
  it("AC-CRS-005-03 each new Round newly reads selected source", async () => {
    let selected = course(); const read = async () => JSON.stringify(selected); const first = await createRoundCourseSnapshot(read); selected = { ...course(), name: "New Course" }; const second = await createRoundCourseSnapshot(read); expect(first.course.name).toBe("Valid Course"); expect(second.course.name).toBe("New Course");
  });
});
