import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { COURSE_SCHEMA } from "./schema.ts";

describe("Course author schema", () => {
  it("is exactly equal to the checked-in machine-readable schema", async () => {
    const schemaUrl = new URL("./course.schema.json", import.meta.url);
    const staticSchema: unknown = JSON.parse(await readFile(schemaUrl, "utf8"));
    expect(staticSchema).toEqual(COURSE_SCHEMA);
  });

  it("forbids Hole name and declared Length fields", () => {
    expect(COURSE_SCHEMA.$defs.hole.additionalProperties).toBe(false);
    expect(Object.keys(COURSE_SCHEMA.$defs.hole.properties)).toEqual([
      "id", "number", "par", "boundary", "tee", "cup", "regions",
    ]);
  });
});
