import { bearingToward, quantizeShotDirection } from "../simulation/inputs.ts";
import { resolveShot, type ResolvedShot } from "../simulation/outcome.ts";
import { captureSelectedCourseSnapshot, selectLoadedCourse } from "./selection.ts";
import { rasterizeCourse } from "./rasterizer.ts";
import { terrainAtPoint } from "./validation.ts";

export interface MinimalCoursePlayResult {
  readonly courseName: string;
  readonly rasterCellCount: number;
  readonly shot: ResolvedShot;
}

/**
 * Narrow T04 integration adapter for the documented minimal Course only.
 * T10/T11 replace this proof seam with the regular Round/gameplay lifecycle.
 * It deliberately has no active Round state or gameplay UI.
 */
export async function playSelectedMinimalCourseAndReturnToPreview(
  cwd: string,
): Promise<MinimalCoursePlayResult> {
  const selected = await captureSelectedCourseSnapshot(cwd);
  if (selected.usedPreviewFallback || selected.course.id !== "minimal-course") {
    throw new Error("Select docs/examples/minimal-course.json before running the minimal Course proof.");
  }

  const snapshot = selected.course;
  const hole = snapshot.holes[0];
  if (hole === undefined) throw new Error("Minimal Course has no playable Hole.");
  const raster = rasterizeCourse(snapshot).holes[0];
  if (raster === undefined || raster.cells.length === 0) throw new Error("Minimal Course did not rasterize a playable Hole.");

  const shot = resolveShot({
    shotId: "t04-minimal-course-proof-shot",
    round: {
      lie: hole.tee,
      playedStrokes: 0,
      penaltyStrokes: 0,
      selectedClub: "putter",
      directionIndex: quantizeShotDirection(bearingToward(hole.tee, hole.cup)),
    },
    power: 1,
    originalLieTerrain: "fairway",
    cup: hole.cup,
    terrainAt: (point) => terrainAtPoint(hole, point),
    // The one full-power putt travels 26/6 Course Units, wholly within this
    // minimal example's 0..20 rectangular boundary; no boundary exit is reachable.
    courseBoundarySweep: () => null,
  });

  await selectLoadedCourse(cwd, "preview");
  return { courseName: snapshot.name, rasterCellCount: raster.cells.length, shot };
}
