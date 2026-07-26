import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { COURSE_SCHEMA } from "./schema.ts";
import { validateCourse, validateCourseStructure } from "./validation.ts";

function structurallyValidCourse(
  regions: readonly unknown[] = [],
  holeOverrides: Readonly<Record<string, unknown>> = {},
): unknown {
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
      regions,
      ...holeOverrides,
    }],
  };
}

describe("Course author schema", () => {
  it("is exactly equal to the checked-in machine-readable schema", async () => {
    const schemaUrl = new URL("./course.schema.json", import.meta.url);
    const staticSchema: unknown = JSON.parse(await readFile(schemaUrl, "utf8"));
    expect(staticSchema).toEqual(COURSE_SCHEMA);
  });

  it("drives runtime structural validation directly", () => {
    const structurallyValid = structurallyValidCourse();
    expect(validateCourseStructure(structurallyValid)).toBe(true);

    const withForbiddenHoleName = structurallyValidCourse([], { name: "Forbidden" });
    expect(validateCourseStructure(withForbiddenHoleName)).toBe(false);
  });

  it("keeps structural acceptance separate from semantic geometry checks", () => {
    const input = structurallyValidCourse();
    expect(validateCourseStructure(input)).toBe(true);

    const result = validateCourse(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.objectContaining({ path: "$.holes[0].cup", code: "cup-not-green" }),
      ]);
    }
  });

  it("forbids Hole name and declared Length fields", () => {
    expect(COURSE_SCHEMA.$defs.hole.additionalProperties).toBe(false);
    expect(Object.keys(COURSE_SCHEMA.$defs.hole.properties)).toEqual([
      "id", "number", "par", "boundary", "tee", "cup", "regions",
    ]);
  });
});
