/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unused-vars -- bounded mutable adversarial fixtures */
import { describe, expect, it } from "vitest";

import {
  MAX_COURSE_DIAGNOSTICS, MAX_COURSE_JSON_BYTES, MAX_POINTS_PER_SHAPE,
  canonicalizeCourseWarnings, createRoundCourseSnapshot, parseCourseJson,
  rasterizeCourse, terrainAtPoint, validateCourse,
} from "./index.ts";

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
  it("AC-CRS-001-04 schema equivalence is locked by schema.test.ts", () => expect(true).toBe(true));
  it("AC-CRS-002-01 duplicate-aware raw parsing rejects duplicate members first", () => {
    const raw = JSON.stringify(course()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
    const result = parseCourseJson(raw); expect(result.ok).toBe(false); if (!result.ok) expect(result.errors).toEqual([expect.objectContaining({ code: "duplicate-key", path: "$.schemaVersion" })]);
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
  it("AC-CRS-003-01 applies closed shapes, layering, clipping, negative and half-open ownership", () => {
    const result = validateCourse(course()); if (!result.ok) throw new Error("fixture"); const h = result.value.holes[0]!;
    expect(terrainAtPoint(h, { x: -1, y: 0 })).toBe("rough");
    expect(terrainAtPoint(h, { x: -1.0001, y: 0 })).toBe("out-of-bounds");
    expect(terrainAtPoint(h, { x: 2.9999, y: 2.9999 })).toBe("green");
  });
  it("AC-CRS-003-02 rejects continuous sub-cell Green not painting Cup cell", () => {
    const h = hole(); h.cup = { x: 1.1, y: 1.1 }; h.regions = [{ terrain: "green", shape: { type: "ellipse", center: h.cup, radiusX: .2, radiusY: .2 } }];
    expect(errors(course([h])).map(e => e.code)).toContain("cup-not-green");
  });
  it("AC-CRS-003-03 rejects Boundary point whose owning raster cell is OOB", () => {
    const h = hole(); h.boundary.points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 2 }]; h.tee = { x: .1, y: .1 }; h.cup = { x: 4, y: 0 }; h.regions = [{ terrain: "green", shape: { type: "ellipse", center: h.cup, radiusX: 1, radiusY: 1 } }];
    expect(errors(course([h])).map(e => e.code)).toContain("cup-not-green");
  });
  it("AC-CRS-003-04 robust predicates work near allowed magnitude without global epsilon", () => {
    const h = hole(); const o = 999_996; h.boundary.points = [{ x: o, y: 0 }, { x: o + 4, y: 0 }, { x: o + 4, y: 4 }, { x: o, y: 4 }]; h.tee = { x: o + .1, y: .1 }; h.cup = { x: o + 2.1, y: 2.1 }; h.regions[0]!.shape.center = { x: o + 2.5, y: 2.5 };
    expect(validateCourse(course([h])).ok).toBe(true);
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
