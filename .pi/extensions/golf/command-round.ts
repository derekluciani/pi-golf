import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, sliceByColumn, type Component, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { createRoundCourseSnapshot } from "./course-loader/snapshot.ts";
import { captureSelectedCourseSnapshot, formatCourseLoadIssue, OUT_OF_BOUNDS, PREVIEW_COURSE_SOURCE, readStableCourseFile, terrainAtPoint } from "./course-loader/index.ts";
import type { Course, CourseHole, Point, RoundCourseSnapshot } from "./course-loader/types.ts";
import { SystemMonotonicClock, type PlayableTerrain } from "./domain/index.ts";
import { GameController, gameOptionsFromRecovered, newRoundState, type GameWriter } from "./game/index.ts";
import { appendRoundReplacement, appendRoundStart, reconstructActiveBranch, RoundMutationWriter, RoundStore, type ReconstructedRound } from "./persistence/index.ts";
import { projectTarget, resolveShot } from "./simulation/index.ts";
import { CameraController, createHudPanels, renderMarkerTile, renderTerrainTile, selectVisibleMarker, type RenderMarker } from "./ui/index.ts";
import { openGolfOverlay } from "./ui/overlay.ts";

const ACTIVE_COMMANDS = new Map<string, Promise<void>>();
const TICK_MILLISECONDS = 50;

function activeKey(ctx: ExtensionCommandContext): string {
  return `${ctx.cwd}\u0000${ctx.sessionManager.getSessionId()}`;
}

async function selectedSnapshot(cwd: string): Promise<RoundCourseSnapshot> {
  const selected = await captureSelectedCourseSnapshot(cwd);
  return selected.sourcePath === PREVIEW_COURSE_SOURCE
    ? createRoundCourseSnapshot(async () => readFile(new URL("./courses/preview-course.json", import.meta.url)))
    : createRoundCourseSnapshot(async () => {
      const stable = await readStableCourseFile(selected.sourcePath);
      if (!stable.ok) throw new Error(formatCourseLoadIssue(stable.issue));
      return stable.bytes;
    });
}

function terrainForShot(hole: CourseHole, point: Point): PlayableTerrain {
  const terrain = terrainAtPoint(hole, point);
  if (terrain === "water" || terrain === "out-of-bounds") throw new Error("Round lie is not on playable Terrain.");
  return terrain;
}

/** Exact first boundary crossing for a bounded ray through a validated simple polygon. */
function boundaryExit(hole: CourseHole, from: Point, direction: Point, maximumDistance: number): number | null {
  const cross = (left: Point, right: Point): number => left.x * right.y - left.y * right.x;
  let nearest: number | null = null;
  for (let index = 0; index < hole.boundary.points.length; index += 1) {
    const start = hole.boundary.points[index];
    const end = hole.boundary.points[index + 1] ?? hole.boundary.points[0];
    if (start === undefined || end === undefined) continue;
    const segment = { x: end.x - start.x, y: end.y - start.y };
    const offset = { x: start.x - from.x, y: start.y - from.y };
    const denominator = cross(direction, segment);
    if (denominator === 0) continue;
    const distance = cross(offset, segment) / denominator;
    const fraction = cross(offset, direction) / denominator;
    if (distance >= 0 && distance <= maximumDistance && fraction >= 0 && fraction <= 1
      && (nearest === null || distance < nearest)) nearest = distance;
  }
  return nearest;
}

function keyName(data: string): string | null {
  if (matchesKey(data, "left")) return "ArrowLeft";
  if (matchesKey(data, "right")) return "ArrowRight";
  if (matchesKey(data, "up")) return "ArrowUp";
  if (matchesKey(data, "down")) return "ArrowDown";
  if (matchesKey(data, "enter")) return "Enter";
  if (matchesKey(data, "escape")) return "Escape";
  if (matchesKey(data, "tab")) return "Tab";
  if (matchesKey(data, "space")) return " ";
  if (data === "q" || data === "Q") return "Q";
  if (data === "r" || data === "R") return "R";
  if (data === "y" || data === "Y") return "Y";
  if (data === "n" || data === "N") return "N";
  if (data === "h" || data === "H") return "H";
  return null;
}

function centerLine(text: string, width: number): string {
  const cropped = truncateToWidth(text, width);
  return `${" ".repeat(Math.max(0, Math.floor((width - visibleWidth(cropped)) / 2)))}${cropped}`;
}

function overlayPanel(row: string, width: number, left: string | undefined, right: string | undefined): string {
  const evenPanel = (text: string, prepend: boolean): string => {
    const cropped = truncateToWidth(text, Math.floor(width / 2));
    return visibleWidth(cropped) % 2 === 0 ? cropped : prepend ? ` ${cropped}` : `${cropped} `;
  };
  const leftText = left === undefined ? "" : evenPanel(left, false);
  const rightText = right === undefined ? "" : evenPanel(right, true);
  const middleStart = visibleWidth(leftText);
  const middleEnd = Math.max(middleStart, width - visibleWidth(rightText));
  return `${leftText}${sliceByColumn(row, middleStart, middleEnd - middleStart)}${rightText}`;
}

/** T11 host-only composition of the authoritative T08/T10 presentation models. */
export class GolfRoundComponent implements Component {
  #timer: ReturnType<typeof setInterval>;
  #closed = false;

  constructor(
    private readonly game: GameController,
    private readonly course: Course,
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: () => void,
  ) {
    this.#timer = setInterval(() => {
      this.game.tick();
      if (this.game.closed) void this.closeAfterDurability();
      this.tui.requestRender();
    }, TICK_MILLISECONDS);
  }

  render(width: number): string[] {
    const height = this.tui.terminal?.rows ?? 20;
    this.game.resize(width, height);
    if (width < 60 || height < 20) return [centerLine("Pi Golf needs at least 60 × 20 terminal cells.", width)];
    const columns = Math.floor(Math.min(120, Math.floor(width)) / 2) * 2;
    const rows = Math.min(60, Math.floor(height));
    const hole = this.course.holes[this.game.round.currentHoleIndex];
    if (hole === undefined) return [centerLine("Current Course Hole is unavailable.", width)];
    const state = this.game.state.kind === "resize-paused" ? this.game.state.suspended.kind : this.game.state.kind;
    if (state === "intro") return Array.from({ length: rows }, (_, row) => row === Math.floor(rows / 2) ? centerLine(this.game.introText, columns) : "");
    if (state === "confirm-abandon") return Array.from({ length: rows }, (_, row) => row === Math.floor(rows / 2) ? centerLine(this.game.confirmationText, columns) : "");
    const summary = state === "round-summary" ? this.roundSummaryLines() : state === "hole-summary" ? this.holeSummaryLines() : null;
    if (summary !== null) return Array.from({ length: rows }, (_, row) => {
      const line = summary[row - Math.floor((rows - summary.length) / 2)];
      return line === undefined ? "" : centerLine(line, columns);
    });

    const camera = this.game.camera.position();
    const originX = Math.floor(camera.x - Math.floor(columns / 2) / 2);
    const originY = Math.floor(camera.y - rows / 2);
    const ball = this.game.playbackFrame?.position ?? this.game.round.lie;
    const lieTerrain = terrainForShot(hole, this.game.round.lie);
    const target = projectTarget({
      lie: this.game.round.lie, lieTerrain, club: this.game.round.selectedClub, power: 1,
      directionIndex: this.game.round.shotDirectionIndex,
      isInsideCourseBoundary: (point) => terrainAtPoint(hole, point) !== OUT_OF_BOUNDS,
    });
    const markers: RenderMarker[] = [
      { kind: "ball", point: ball },
      { kind: lieTerrain === "green" ? "cup" : "flag", point: hole.cup },
      ...(state === "aiming" ? [{ kind: "target" as const, point: target.position }] : []),
    ];
    const panels = createHudPanels(this.game.hudScore, {
      club: this.game.round.selectedClub, lieTerrain, shotDirection: `${this.game.round.shotDirectionIndex * 22.5}°`,
      targetDistance: `${target.distance} Course Units`, oobTargetWarning: target.isOutOfBounds,
    }, ["Arrows aim · Space Stroke", "Tab camera · H HUD · Esc save"],
    state === "metering" ? [this.theme.fg("accent", "█".repeat(this.game.meterBlocks))] : this.game.playbackFrame === null ? [] : [`Ball Speed ${this.game.playbackFrame.speed.toFixed(2)}`]);

    return Array.from({ length: rows }, (_, row) => {
      const terrain = Array.from({ length: Math.floor(columns / 2) }, (_, column) => terrainAtPoint(hole, { x: originX + column + .5, y: originY + row + .5 }));
      const rendered = terrain.map(renderTerrainTile);
      for (let column = 0; column < rendered.length; column += 1) {
        const point = { x: originX + column, y: originY + row };
        const visible = selectVisibleMarker(markers.filter((marker) => Math.floor(marker.point.x) === point.x && Math.floor(marker.point.y) === point.y));
        if (visible !== undefined) rendered[column] = renderMarkerTile(visible);
      }
      const canvas = rendered.join("");
      if (!this.game.hudVisible) return canvas;
      return overlayPanel(canvas, columns, panels.topLeft[row] ?? panels.bottomLeft[row - (rows - panels.bottomLeft.length)], panels.topRight[row] ?? panels.bottomRight[row - (rows - panels.bottomRight.length)]);
    });
  }

  private holeSummaryLines(): readonly string[] {
    const summary = this.game.holeSummary();
    return summary === null ? [] : [summary.text, `Hole ${summary.score.holeNumber} · Par ${summary.score.par}`, `Played Strokes ${summary.score.playedStrokes} · Penalty Strokes ${summary.score.penaltyStrokes}`, `Hole Score ${summary.score.holeScore} · Round Score ${summary.roundScore}`, "Enter or Space to continue"];
  }

  private roundSummaryLines(): readonly string[] {
    const summary = this.game.roundSummary();
    return summary === null ? [] : ["Round complete", ...summary.scorecard.map((line) => `Hole ${line.holeNumber} · Par ${line.par} · Hole Score ${line.holeScore}`), `Round Score ${summary.roundScore} · Total Par ${summary.totalPar}`, "R new Round · Esc save and close"];
  }

  handleInput(data: string): void {
    const key = keyName(data);
    if (key !== null) this.game.key(key);
    this.tui.requestRender();
    if (this.game.closed) void this.closeAfterDurability();
  }

  invalidate(): void {}
  dispose(): void { clearInterval(this.#timer); }
  async closeAfterDurability(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.game.whenIdle();
    this.dispose();
    this.done();
  }
}

export function mirrorAcceptedMutations(pi: Pick<ExtensionAPI, "appendEntry">, writer: GameWriter, roundId: string): GameWriter {
  const mirror = async (work: Promise<number>): Promise<number> => {
    const revision = await work;
    pi.appendEntry("pi-golf-round-v1", { roundId, revision });
    return revision;
  };
  return {
    commitShot: (shot, state) => mirror(writer.commitShot(shot, state)),
    append: (entry) => mirror(writer.append(entry)),
  };
}

async function buildGame(
  pi: ExtensionAPI,
  store: RoundStore,
  sessionId: string,
  recovered: ReconstructedRound,
  snapshot: RoundCourseSnapshot,
): Promise<GameController> {
  const durableWriter = await RoundMutationWriter.forSession(store, sessionId, recovered.roundId, recovered.revision);
  const writer = mirrorAcceptedMutations(pi, durableWriter, recovered.roundId);
  const clock = new SystemMonotonicClock();
  let game: GameController | undefined = undefined;
  const hole = (): CourseHole => {
    const current = snapshot.course.holes[game?.round.currentHoleIndex ?? recovered.state.currentHoleIndex];
    if (current === undefined) throw new Error("Current Course Hole is unavailable.");
    return current;
  };
  let activeShotId = "";
  const presentation = {
    camera: new CameraController(clock, recovered.state.lie, snapshot.course.holes[recovered.state.currentHoleIndex]?.cup ?? recovered.state.lie),
    target: () => hole().cup,
  };
  game = new GameController(gameOptionsFromRecovered(snapshot, recovered, {
    writer,
    clock,
    shotId: () => { activeShotId = randomUUID(); return activeShotId; },
    resolve: (power) => {
      const currentHole = hole();
      const activeGame = game;
      const round = activeGame?.round;
      if (round === undefined || activeGame === undefined) throw new Error("Game Round is unavailable.");
      return resolveShot({
        shotId: activeShotId,
        round: { lie: round.lie, playedStrokes: activeGame.hudScore.playedStrokes, penaltyStrokes: activeGame.hudScore.penaltyStrokes, selectedClub: round.selectedClub, directionIndex: round.shotDirectionIndex },
        power,
        originalLieTerrain: terrainForShot(currentHole, round.lie),
        cup: currentHole.cup,
        terrainAt: (point) => terrainAtPoint(currentHole, point),
        courseBoundarySweep: (from, direction, distance) => boundaryExit(currentHole, from, direction, distance),
      });
    },
    presentation,
  }));
  return game;
}

async function openRound(pi: ExtensionAPI, ctx: ExtensionCommandContext, store: RoundStore, round: ReconstructedRound, snapshot: RoundCourseSnapshot): Promise<void> {
  const game = await buildGame(pi, store, ctx.sessionManager.getSessionId(), round, snapshot);
  await openGolfOverlay(ctx, (tui, theme, _keybindings, done) => new GolfRoundComponent(game, snapshot.course, tui, theme, () => done(undefined)));
}

async function startRound(store: RoundStore, snapshot: RoundCourseSnapshot, branchId: string): Promise<ReconstructedRound> {
  return appendRoundStart(store, { roundId: randomUUID(), snapshot, state: newRoundState(snapshot), branchId });
}

export async function runGolfRoundCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, replace: boolean): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Pi Golf requires interactive TUI mode.", "warning");
    return;
  }
  const key = activeKey(ctx);
  const running = ACTIVE_COMMANDS.get(key);
  if (running !== undefined) return running;
  const work = (async () => {
    const store = new RoundStore({ root: join(ctx.cwd, ".pi/golf/rounds") });
    const branchId = ctx.sessionManager.getSessionId();
    let recovered = await reconstructActiveBranch(store, ctx.sessionManager.getBranch(), branchId);
    if (replace && recovered !== null && !recovered.terminal) {
      const confirmed = await ctx.ui.confirm("Start a new Round?", "Replace the active Round?");
      if (!confirmed) return;
      const snapshot = await selectedSnapshot(ctx.cwd);
      const successorId = randomUUID();
      // The branch mirror may have been interrupted after a durable mutation. The
      // store is authoritative, so replacement always links its current revision.
      const predecessor = await store.read(recovered.roundId);
      const successor = await appendRoundReplacement(store, {
        predecessorRoundId: predecessor.roundId,
        predecessorRevision: predecessor.revision,
        successorRoundId: successorId,
        successorSnapshot: snapshot,
        successorState: newRoundState(snapshot),
        branchId,
      });
      pi.appendEntry("pi-golf-round-v1", { roundId: predecessor.roundId, revision: predecessor.revision + 1 });
      await openRound(pi, ctx, store, successor, snapshot);
      return;
    }
    if (recovered === null || recovered.terminal || replace) {
      const snapshot = await selectedSnapshot(ctx.cwd);
      recovered = await startRound(store, snapshot, branchId);
      pi.appendEntry("pi-golf-round-v1", { roundId: recovered.roundId, revision: recovered.revision });
      await openRound(pi, ctx, store, recovered, snapshot);
      return;
    }
    const snapshot = await createRoundCourseSnapshot(async () => {
      const start = await store.startEntry(recovered.roundId);
      return start.payload.courseSnapshot;
    });
    await openRound(pi, ctx, store, recovered, snapshot);
  })();
  ACTIVE_COMMANDS.set(key, work);
  try { await work; } finally { if (ACTIVE_COMMANDS.get(key) === work) ACTIVE_COMMANDS.delete(key); }
}
