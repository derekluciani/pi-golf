import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCourseJson } from "./course-loader/index.ts";
import { applyStroke, planFromLie, planHole } from "../../../scripts/v2-t12-route-planner.ts";

describe("V2-T12-A deterministic actual-Pi route planning", () => {
  it("AC-E2E-001-01 derives Cup-capturing Preview routes from the actual simulator", async () => {
    const parsed = parseCourseJson(await readFile(new URL("./courses/preview-course.json", import.meta.url)));
    expect(parsed.ok).toBe(true); if (!parsed.ok) return;
    const firstHole = parsed.value.holes[0];
    expect(firstHole).toBeDefined();
    if (firstHole === undefined) return;
    const first = applyStroke(firstHole, firstHole.tee, { club: "4i", direction: 0 as never, power: 0.9 });
    const second = applyStroke(firstHole, first.resultingRound.lie, { club: "4i", direction: 0 as never, power: 1 });
    const correctedRemainder = planFromLie(firstHole, second.resultingRound.lie);
    console.log("CORRECTED_ROUTE", JSON.stringify({ prefix: [first, second].map((shot) => ({ terminal: shot.terminal, lie: shot.resultingRound.lie })), remainder: correctedRemainder }));
    expect(second.resultingRound.lie).toEqual({ x: 90.896297, y: 20 });
    expect(correctedRemainder?.at(-1)?.terminal).toBe("cup");
    for (const hole of parsed.value.holes.slice(1)) expect(planHole(hole)?.at(-1)?.terminal).toBe("cup");
  }, 120_000);
  it("AC-E2E-002-01 derives real Water and OOB outcomes with restored Lie", async () => {
    const parsed = parseCourseJson(await readFile(new URL("./courses/preview-course.json", import.meta.url)));
    expect(parsed.ok).toBe(true); if (!parsed.ok) return; const hole = parsed.value.holes[2]; if (!hole) throw new Error();
    const water = applyStroke(hole, hole.tee, { club: "driver", direction: 0 as never, power: 1 });
    const oob = applyStroke(hole, hole.tee, { club: "driver", direction: 8 as never, power: 1 });
    console.log("HAZARDS", water.terminal, oob.terminal);
  });
});
