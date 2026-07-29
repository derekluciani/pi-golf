import { readFile } from "node:fs/promises";

import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  calculateHoleLength,
  OUT_OF_BOUNDS,
  parseCourse,
  parseCourseJson,
  rasterizeCourse,
  terrainAtCell,
  terrainAtPoint,
  type Course,
  type CourseHole,
} from "../course-loader/index.ts";
import { type Power } from "../domain/index.ts";
import { bearingToward, quantizeShotDirection, resolveShot, type CompactRoundState } from "../simulation/index.ts";
import { loadPreviewCourse } from "./index.ts";

const previewUrl = new URL("./preview-course.json", import.meta.url);
const staticSchemaUrl = new URL("../course-loader/course.schema.json", import.meta.url);

async function readJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(url, "utf8"));
}

function isJsonSchema(input: unknown): input is AnySchema {
  return typeof input === "boolean"
    || (typeof input === "object" && input !== null && !Array.isArray(input));
}

function requireValidCourse(input: unknown): Course {
  const result = parseCourse(input);
  if (!result.ok) throw new Error(`Course fixture is invalid: ${JSON.stringify(result.errors)}`);
  expect(result.warnings).toEqual([]);
  return result.value;
}

function requireHole(course: Course, index: number): CourseHole {
  const hole = course.holes[index];
  if (hole === undefined) throw new Error(`Missing Hole at index ${index}.`);
  return hole;
}

function shotAtCup(
  round: CompactRoundState,
  hole: CourseHole,
  shotId: string,
  club: CompactRoundState["selectedClub"],
  power: Power = 1,
) {
  const terrain = terrainAtPoint(hole, round.lie);
  if (terrain === OUT_OF_BOUNDS || terrain === "water") throw new Error("Shot must begin on playable Terrain.");
  return resolveShot({
    shotId,
    round: { ...round, selectedClub: club, directionIndex: quantizeShotDirection(bearingToward(round.lie, hole.cup)) },
    power,
    originalLieTerrain: terrain,
    cup: hole.cup,
    terrainAt: (point) => terrainAtPoint(hole, point),
    // The demonstrated shots stay inside this Hole's Boundary; no sweep occurs.
    courseBoundarySweep: () => null,
  });
}

function expectBoundaryExtents(hole: CourseHole, width: number, height: number): void {
  const xs = hole.boundary.points.map((point) => point.x);
  const ys = hole.boundary.points.map((point) => point.y);
  expect(Math.max(...xs) - Math.min(...xs)).toBe(width);
  expect(Math.max(...ys) - Math.min(...ys)).toBe(height);
}

describe("shipped Course JSON artifacts", () => {
  it("validates the editable Preview artifact directly against the checked-in schema", async () => {
    const staticSchema = await readJson(staticSchemaUrl);
    if (!isJsonSchema(staticSchema)) throw new Error("Static Course schema is not a JSON Schema object.");
    const validateStaticSchema = new Ajv2020({ allErrors: true, strict: true }).compile(staticSchema);

    expect(validateStaticSchema(await readJson(previewUrl)), validateStaticSchema.errors?.map((error) => error.instancePath).join(", ")).toBe(true);
  });
});

describe("Preview Course content", () => {
  it("AC-CNT-001-03 loads JSON through public parsing, immutable snapshot, and rasterization without a privileged path", async () => {
    const raw = await readFile(previewUrl);
    const parsed = parseCourseJson(raw);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    const loaded = await loadPreviewCourse();
    expect(loaded.course).toEqual(parsed.value);
    expect(Object.isFrozen(loaded.course)).toBe(true);
    expect(Object.isFrozen(loaded.course.holes)).toBe(true);
    expect(loaded.raster).toEqual(rasterizeCourse(loaded.course));
    expect(loaded.warnings).toEqual([]);
  });

  it("AC-CRS-002-01 built-in loading rejects duplicate members before decoding", async () => {
    const raw = await readFile(previewUrl, "utf8");
    const duplicate = raw.replace(/"schemaVersion"\s*:\s*1/u, '"schemaVersion": 1, "schemaVersion": 1');
    expect(parseCourseJson(duplicate).ok).toBe(false);
    await expect(loadPreviewCourse(async () => duplicate)).rejects.toThrow("duplicate-key");
  });

  it("AC-CNT-001-01 has exact identity, Hole order, pars, total par, and calculated Lengths", async () => {
    const course = requireValidCourse(await readJson(previewUrl));
    expect(course.id).toBe("preview-course");
    expect(course.name).toBe("Preview Course");
    expect(course.holes.map(({ id, number, par }) => ({ id, number, par }))).toEqual([
      { id: "hole-1", number: 1, par: 4 },
      { id: "hole-2", number: 2, par: 3 },
      { id: "hole-4", number: 4, par: 5 },
    ]);
    expect(course.holes.reduce((total, hole) => total + hole.par, 0)).toBe(12);
    expect(course.holes.map(calculateHoleLength)).toEqual([105, 55, 160]);
  });

  it("defines Hole 1's rounded Boundary, straight Fairway, and Green", async () => {
    const hole = requireHole(requireValidCourse(await readJson(previewUrl)), 0);
    expect(hole.tee).toEqual({ x: 8, y: 20 });
    expect(hole.cup).toEqual({ x: 113, y: 20 });
    expectBoundaryExtents(hole, 120, 40);
    expect(hole.boundary.points).toEqual(expect.arrayContaining([
      { x: 5, y: 0 }, { x: 120, y: 5 }, { x: 115, y: 40 }, { x: 0, y: 35 },
    ]));
    expect(hole.regions).toEqual([
      {
        terrain: "fairway",
        shape: {
          type: "corridor",
          points: [{ x: 8, y: 20 }, { x: 113, y: 20 }],
          width: 18,
        },
      },
      {
        terrain: "green",
        shape: {
          type: "ellipse",
          center: { x: 113, y: 20 },
          radiusX: 8,
          radiusY: 6,
        },
      },
    ]);
    expect(hole.regions.some((region) => region.terrain === "bunker" || region.terrain === "water")).toBe(false);
  });

  it("defines Hole 2's ordered Fairway interruption, Green, and guard Bunkers", async () => {
    const hole = requireHole(requireValidCourse(await readJson(previewUrl)), 1);
    expect(hole.tee).toEqual({ x: 8, y: 43 });
    expect(hole.cup).toEqual({ x: 52, y: 10 });
    expectBoundaryExtents(hole, 65, 50);
    expect(hole.regions.map((region) => region.terrain)).toEqual([
      "fairway", "rough", "green", "bunker", "bunker",
    ]);
    expect(hole.regions.map((region) => region.shape)).toEqual([
      { type: "corridor", points: [{ x: 8, y: 43 }, { x: 52, y: 10 }], width: 12 },
      { type: "ellipse", center: { x: 28, y: 28 }, radiusX: 6, radiusY: 5 },
      { type: "ellipse", center: { x: 52, y: 10 }, radiusX: 7, radiusY: 6 },
      { type: "ellipse", center: { x: 43, y: 7 }, radiusX: 5, radiusY: 4 },
      { type: "ellipse", center: { x: 53, y: 19 }, radiusX: 5, radiusY: 4 },
    ]);
    expect(terrainAtPoint(hole, { x: 28, y: 28 })).toBe("rough");
    expect(terrainAtPoint(hole, { x: 43, y: 7 })).toBe("bunker");
    expect(terrainAtPoint(hole, hole.cup)).toBe("green");
    expect(hole.regions.some((region) => region.terrain === "water")).toBe(false);
  });

  it("defines Hole 4's ordered Fairway, full-height Water crossing, Green, and Bunkers", async () => {
    const hole = requireHole(requireValidCourse(await readJson(previewUrl)), 2);
    expect(hole.tee).toEqual({ x: 8, y: 30 });
    expect(hole.cup).toEqual({ x: 168, y: 30 });
    expectBoundaryExtents(hole, 180, 60);
    expect(hole.regions.map((region) => region.terrain)).toEqual([
      "fairway", "water", "green", "bunker", "bunker",
    ]);
    expect(hole.regions.map((region) => region.shape)).toEqual([
      {
        type: "corridor",
        points: [{ x: 8, y: 30 }, { x: 65, y: 22 }, { x: 110, y: 38 }, { x: 168, y: 30 }],
        width: 16,
      },
      {
        type: "polygon",
        points: [{ x: 75, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 75, y: 60 }],
      },
      { type: "ellipse", center: { x: 168, y: 30 }, radiusX: 8, radiusY: 7 },
      { type: "ellipse", center: { x: 157, y: 20 }, radiusX: 6, radiusY: 4 },
      { type: "ellipse", center: { x: 157, y: 40 }, radiusX: 6, radiusY: 4 },
    ]);
    expect(terrainAtPoint(hole, { x: 80, y: 1 })).toBe("water");
    expect(terrainAtPoint(hole, { x: 80, y: 30 })).toBe("water");
    expect(terrainAtPoint(hole, { x: 80, y: 59 })).toBe("water");
    expect(terrainAtPoint(hole, { x: 74, y: 30 })).toBe("fairway");
    expect(terrainAtPoint(hole, { x: 101, y: 30 })).toBe("fairway");
    expect(terrainAtPoint(hole, hole.cup)).toBe("green");
  });

  it("AC-CNT-001-02 resolves every tee to playable Terrain and every Cup to Green in gameplay raster geometry", async () => {
    const course = requireValidCourse(await readJson(previewUrl));
    const raster = rasterizeCourse(course);

    course.holes.forEach((hole, index) => {
      const teeTerrain = terrainAtPoint(hole, hole.tee);
      expect(["rough", "fairway", "green"]).toContain(teeTerrain);
      expect(terrainAtPoint(hole, hole.cup)).toBe("green");

      const holeRaster = raster.holes[index];
      if (holeRaster === undefined) throw new Error(`Missing rasterized Hole at index ${index}.`);
      expect(["rough", "fairway", "green"]).toContain(
        terrainAtCell(holeRaster, Math.floor(hole.tee.x), Math.floor(hole.tee.y)),
      );
      expect(terrainAtCell(holeRaster, Math.floor(hole.cup.x), Math.floor(hole.cup.y))).toBe("green");
    });
  });

  it("AC-CNT-001-04 proves the ordered Preview Course is completable through public Course and simulation APIs", async () => {
    const course = (await loadPreviewCourse()).course;
    const hole1 = requireHole(course, 0);
    const hole2 = requireHole(course, 1);
    const hole4 = requireHole(course, 2);
    const completedHoleIds: string[] = [];

    const startHole = (hole: CourseHole): CompactRoundState => ({
      lie: hole.tee, playedStrokes: 0, penaltyStrokes: 0, selectedClub: "driver", directionIndex: 0 as never,
    });
    const completeHole = (
      hole: CourseHole,
      round: CompactRoundState,
      shots: readonly [string, CompactRoundState["selectedClub"], Power][],
    ): void => {
      const firstShot = shots[0];
      if (firstShot === undefined) throw new Error("Completion requires at least one Shot.");
      let completion = shotAtCup(round, hole, ...firstShot);
      expect(completion.terminal).toBe(shots.length === 1 ? "cup" : "rest");
      for (const [shotId, club, power] of shots.slice(1)) {
        completion = shotAtCup(completion.resultingRound, hole, shotId, club, power);
        expect(completion.terminal).toBe(shotId.endsWith("completion") ? "cup" : "rest");
      }
      expect(completion.terminal).toBe("cup");
      expect(completion.resultingRound.penaltyStrokes).toBe(0);
      completedHoleIds.push(hole.id);
    };

    completeHole(hole1, startHole(hole1), [
      ["hole-1-approach", "4i", 0.9],
      ["hole-1-completion", "driver", 1],
    ]);
    completeHole(hole2, startHole(hole2), [
      ["hole-2-approach", "driver", 1],
      ["hole-2-completion", "driver", 0.3],
    ]);

    let round = startHole(hole4);
    const firstDriver = shotAtCup(round, hole4, "hole-4-first-driver", "driver");
    expect(firstDriver.terminal).toBe("rest");
    expect(firstDriver.finalPosition.x).toBeLessThan(75);
    expect(terrainAtPoint(hole4, firstDriver.finalPosition)).not.toBe("water");
    round = firstDriver.resultingRound;

    const positioningWedge = shotAtCup(round, hole4, "hole-4-positioning-wedge", "pw");
    expect(positioningWedge.terminal).toBe("rest");
    round = positioningWedge.resultingRound;

    const clearingDriver = shotAtCup(round, hole4, "hole-4-clearing-driver", "driver");
    expect(clearingDriver.landingPosition.x).toBeGreaterThan(100);
    expect(clearingDriver.terminal).toBe("rest");
    round = clearingDriver.resultingRound;
    for (const [shotId, club, power] of [
      ["hole-4-approach-1", "pw", 1],
      ["hole-4-approach-2", "pw", 1],
      ["hole-4-approach-3", "pw", 0.7],
    ] as const) {
      const approach = shotAtCup(round, hole4, shotId, club, power);
      expect(approach.terminal).toBe("rest");
      round = approach.resultingRound;
    }
    let completion = shotAtCup(round, hole4, "hole-4-putt-1", "putter", 0.1);
    for (let putt = 2; completion.terminal !== "cup" && putt <= 6; putt += 1) {
      completion = shotAtCup(completion.resultingRound, hole4, `hole-4-putt-${putt}`, "putter", 0.1);
    }
    expect(completion.terminal).toBe("cup");
    expect(completion.resultingRound.penaltyStrokes).toBe(0);
    completedHoleIds.push(hole4.id);

    expect(completedHoleIds).toEqual(["hole-1", "hole-2", "hole-4"]);
  });

  it("validates the mandatory airborne Water crossing and rasterizes deterministically", async () => {
    const input = await readJson(previewUrl);
    const firstValidation = parseCourse(input);
    const secondValidation = parseCourse(input);
    expect(firstValidation).toEqual(secondValidation);
    if (!firstValidation.ok) throw new Error(JSON.stringify(firstValidation.errors));

    const first = Buffer.from(JSON.stringify(rasterizeCourse(firstValidation.value)));
    const second = Buffer.from(JSON.stringify(rasterizeCourse(firstValidation.value)));
    expect(first.equals(second)).toBe(true);
  });
});
