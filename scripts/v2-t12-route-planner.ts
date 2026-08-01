import { readFile } from "node:fs/promises";
import { parseCourseJson, terrainAtPoint, type CourseHole, type Point } from "../.pi/extensions/golf/course-loader/index.ts";
import { CLUB_ORDER, POWER_LEVELS, type Club, type PlayableTerrain, type Power, type ShotDirectionIndex } from "../.pi/extensions/golf/domain/index.ts";
import { resolveShot } from "../.pi/extensions/golf/simulation/index.ts";

export interface PlannedStroke { readonly club: Club; readonly direction: ShotDirectionIndex; readonly power: Power; readonly terminal: string; readonly lie: Point; }

function boundaryExit(hole: CourseHole, from: Point, direction: Point, maximumDistance: number): number | null {
  const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
  let nearest: number | null = null;
  for (let i = 0; i < hole.boundary.points.length; i += 1) {
    const start = hole.boundary.points[i]; const end = hole.boundary.points[i + 1] ?? hole.boundary.points[0];
    if (start === undefined || end === undefined) continue;
    const segment = { x: end.x - start.x, y: end.y - start.y }; const offset = { x: start.x - from.x, y: start.y - from.y };
    const denominator = cross(direction, segment); if (denominator === 0) continue;
    const distance = cross(offset, segment) / denominator; const fraction = cross(offset, direction) / denominator;
    if (distance >= 0 && distance <= maximumDistance && fraction >= 0 && fraction <= 1 && (nearest === null || distance < nearest)) nearest = distance;
  }
  return nearest;
}

export function applyStroke(hole: CourseHole, lie: Point, stroke: Pick<PlannedStroke, "club" | "direction" | "power">) {
  const terrain = terrainAtPoint(hole, lie);
  if (terrain === "water" || terrain === "out-of-bounds") throw new Error("invalid Lie");
  return resolveShot({ shotId: "route", round: { lie, playedStrokes: 0, penaltyStrokes: 0, selectedClub: stroke.club, directionIndex: stroke.direction }, power: stroke.power, originalLieTerrain: terrain as PlayableTerrain, cup: hole.cup, terrainAt: (point) => terrainAtPoint(hole, point), courseBoundarySweep: (from, direction, distance) => boundaryExit(hole, from, direction, distance) });
}

export function planFromLie(hole: CourseHole, initialLie: Point, maximumStrokes = 8): readonly PlannedStroke[] | null {
  let frontier: { lie: Point; route: PlannedStroke[] }[] = [{ lie: initialLie, route: [] }];
  const seen = new Set<string>();
  for (let depth = 0; depth < maximumStrokes; depth += 1) {
    const next: typeof frontier = [];
    for (const state of frontier) for (const club of CLUB_ORDER) for (let direction = 0; direction < 16; direction += 1) for (const power of POWER_LEVELS) {
      const shot = applyStroke(hole, state.lie, { club, direction: direction as ShotDirectionIndex, power });
      const route = [...state.route, { club, direction: direction as ShotDirectionIndex, power, terminal: shot.terminal, lie: shot.resultingRound.lie }];
      if (shot.terminal === "cup") return route;
      if (shot.terminal !== "rest") continue;
      const key = `${shot.resultingRound.lie.x.toFixed(2)},${shot.resultingRound.lie.y.toFixed(2)}`;
      if (!seen.has(key)) { seen.add(key); next.push({ lie: shot.resultingRound.lie, route }); }
    }
    next.sort((a, b) => Math.hypot(a.lie.x - hole.cup.x, a.lie.y - hole.cup.y) - Math.hypot(b.lie.x - hole.cup.x, b.lie.y - hole.cup.y));
    frontier = next.slice(0, 200);
  }
  return null;
}

export function planHole(hole: CourseHole, maximumStrokes = 8): readonly PlannedStroke[] | null {
  return planFromLie(hole, hole.tee, maximumStrokes);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const parsed = parseCourseJson(await readFile(new URL("../.pi/extensions/golf/courses/preview-course.json", import.meta.url)));
  if (!parsed.ok) throw new Error("invalid Preview Course");
  for (const hole of parsed.value.holes) console.log(JSON.stringify({ hole: hole.number, route: planHole(hole) }));
}
