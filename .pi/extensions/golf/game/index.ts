import {
  POWER_LEVELS, POWER_METER, TIMING, parseCourseHoleIndex, parseCourseId, parseHoleId, parseHoleNumber,
  parseShotDirectionIndex, type Club, type MonotonicClock, type PersistedHoleScore, type PersistedRoundState,
  type Power, type ShotDirectionIndex,
} from "../domain/index.ts";
import { bearingToward, quantizeShotDirection, selectAdjacentClub, selectAdjacentDirection } from "../simulation/inputs.ts";
import { toDurableShot, type DurableResolvedShot, type ResolvedShot } from "../simulation/outcome.ts";
import type { Course, CourseHole, RoundCourseSnapshot } from "../course-loader/types.ts";
import type { ReconstructedRound } from "../persistence/index.ts";
import type { ScoringHud } from "../ui/hud.ts";

/** Nine mutually-exclusive states; resize-paused is an orthogonal wrapper. */
export const GAME_BASE_STATES = ["intro", "aiming", "metering", "committing", "playback", "penalty-notice", "hole-summary", "round-summary", "confirm-abandon"] as const;
export type GameBaseStateName = (typeof GAME_BASE_STATES)[number];
export type QueuedAction = "pause" | "abandon" | null;
type Timed = { readonly beganAt: number };
export type GameBaseState =
  | ({ readonly kind: "intro" } & Timed)
  | { readonly kind: "aiming" }
  | ({ readonly kind: "metering"; readonly requiresNewPress: boolean } & Timed)
  | { readonly kind: "committing"; readonly shotId: string; readonly shot: ResolvedShot; readonly next: PersistedRoundState; readonly queued: QueuedAction; readonly error: string | null }
  | ({ readonly kind: "playback"; readonly shot: ResolvedShot; readonly queued: QueuedAction } & Timed)
  | ({ readonly kind: "penalty-notice"; readonly terminal: "water" | "out-of-bounds"; readonly queued: QueuedAction } & Timed)
  | { readonly kind: "hole-summary" }
  | { readonly kind: "round-summary" }
  | ({ readonly kind: "confirm-abandon"; readonly prior: Exclude<GameBaseState, { readonly kind: "confirm-abandon" }> } & Timed);
export type GameState = GameBaseState | { readonly kind: "resize-paused"; readonly suspended: GameBaseState };

/** T09 mutation surface; Game never writes presentation state. */
export interface GameWriter {
  commitShot(shot: DurableResolvedShot, state: PersistedRoundState): Promise<number>;
  append(entry: { readonly kind: "checkpoint"; readonly payload: { readonly state: PersistedRoundState; readonly lifecycle: "aiming" | "hole-summary" } } | { readonly kind: "round-terminal"; readonly payload: { readonly status: "complete" | "abandoned"; readonly state: PersistedRoundState } }): Promise<number>;
}
/** Narrow T08 hooks. They receive resolved data but cannot mutate canonical state. */
export interface GamePresentation {
  readonly aim?: (lie: { readonly x: number; readonly y: number }) => void;
  readonly changedAim?: (lie: { readonly x: number; readonly y: number }) => void;
  readonly tab?: () => void;
  readonly playback?: (shot: ResolvedShot) => void;
  readonly recenter?: (lie: { readonly x: number; readonly y: number }) => void;
  readonly freeze?: () => void;
  readonly resume?: () => void;
}
export interface GameControllerOptions {
  readonly course: Course;
  readonly state: PersistedRoundState;
  readonly writer: GameWriter;
  readonly clock: MonotonicClock;
  readonly shotId: () => string;
  readonly resolve: (power: Power) => ResolvedShot;
  readonly replaceRound?: () => Promise<void>;
  readonly presentation?: GamePresentation;
  /** Recovered rounds intentionally discard intro, meter, notices and playback. */
  readonly resumed?: boolean;
  /** T09 deliberately persists only input-required Hole-summary lifecycle. */
  readonly recoveredLifecycle?: "aiming" | "hole-summary";
  readonly currentHolePlayedStrokes?: number;
  readonly currentHolePenaltyStrokes?: number;
}
export interface ScoreLine { readonly holeNumber: number; readonly par: number; readonly playedStrokes: number; readonly penaltyStrokes: number; readonly holeScore: number; }
export interface HoleSummary { readonly text: "It's in the hole!"; readonly score: ScoreLine; readonly roundScore: number; }
export interface RoundSummary { readonly scorecard: readonly ScoreLine[]; readonly roundScore: number; readonly totalPar: number; }

/** Creates the canonical state for a selected immutable T04 Course snapshot. */
export function newRoundState(snapshot: RoundCourseSnapshot): PersistedRoundState {
  const first = snapshot.course.holes[0]; const courseId = parseCourseId(snapshot.course.id); const index = parseCourseHoleIndex(0);
  if (first === undefined || courseId === undefined || index === undefined) throw new Error("Course snapshot has no valid first Hole.");
  const direction = parseShotDirectionIndex(quantizeShotDirection(bearingToward(first.tee, first.cup)));
  if (direction === undefined) throw new Error("First Hole Cup direction is invalid.");
  return { kind: "persisted-round", courseId, currentHoleIndex: index, lie: { ...first.tee }, selectedClub: "driver", shotDirectionIndex: direction, holeScores: [], status: "active" };
}
/** Reconstructs only durable state; no transient presentation state is accepted or reused. */
export function gameOptionsFromRecovered(snapshot: RoundCourseSnapshot, recovered: ReconstructedRound, options: Omit<GameControllerOptions, "course" | "state" | "resumed" | "recoveredLifecycle" | "currentHolePlayedStrokes" | "currentHolePenaltyStrokes">): GameControllerOptions {
  if (recovered.state.status !== "active" || recovered.terminal || recovered.state.courseId !== snapshot.course.id || (recovered.lifecycle !== "aiming" && recovered.lifecycle !== "hole-summary")) throw new Error("Recovered Round is not an active snapshot Round.");
  return { ...options, course: snapshot.course, state: recovered.state, resumed: true, recoveredLifecycle: recovered.lifecycle, currentHolePlayedStrokes: recovered.currentHolePlayedStrokes, currentHolePenaltyStrokes: recovered.currentHolePenaltyStrokes };
}

export class GameController {
  #base: GameBaseState; #suspended = false; #suspendedAt: number | null = null;
  #round: PersistedRoundState; #played: number; #penalties: number; #hudVisible = true; #closed = false;
  #commitPromise: Promise<void> | null = null; #advancePromise: Promise<void> | null = null;
  #checkpointPromise: Promise<void> | null = null; #terminalPromise: Promise<void> | null = null; #replacementPromise: Promise<void> | null = null;
  readonly #course: Course; readonly #writer: GameWriter; readonly #clock: MonotonicClock; readonly #shotId: () => string;
  readonly #resolve: (power: Power) => ResolvedShot; readonly #replaceRound: (() => Promise<void>) | undefined; readonly #presentation: GamePresentation | undefined;

  constructor(options: GameControllerOptions) {
    if (options.state.status !== "active" || options.state.courseId !== options.course.id || options.course.holes[options.state.currentHoleIndex] === undefined) throw new Error("Game requires an active persisted Round matching its Course snapshot.");
    this.#course = options.course; this.#round = options.state; this.#writer = options.writer; this.#clock = options.clock; this.#shotId = options.shotId; this.#resolve = options.resolve; this.#replaceRound = options.replaceRound; this.#presentation = options.presentation;
    this.#played = options.currentHolePlayedStrokes ?? 0; this.#penalties = options.currentHolePenaltyStrokes ?? 0;
    if (!Number.isInteger(this.#played) || this.#played < 0 || !Number.isInteger(this.#penalties) || this.#penalties < 0) throw new Error("Recovered Hole score is invalid.");
    this.#base = options.resumed ? (options.recoveredLifecycle === "hole-summary" ? { kind: "hole-summary" } : { kind: "aiming" }) : { kind: "intro", beganAt: this.now() };
    this.#presentation?.aim?.(this.#round.lie);
  }
  get state(): GameState { return this.#suspended ? { kind: "resize-paused", suspended: this.#base } : this.#base; }
  get round(): PersistedRoundState { return this.#round; }
  get closed(): boolean { return this.#closed; }
  get hudVisible(): boolean { return this.#hudVisible; }
  get meterBlocks(): number { return this.#base.kind === "metering" ? meterBlocksAt(this.now() - this.#base.beganAt) : POWER_METER.minimumBlocks; }
  get introText(): string { const hole = this.hole(); return `${this.#course.name} — Hole ${hole.number} — Par ${hole.par}`; }
  get confirmationText(): string { return "Abandon the active Round?"; }
  get hudScore(): ScoringHud { const hole = this.hole(); return { hole: hole.number, par: hole.par, holeScore: this.holeScore(), roundScore: this.roundScore() }; }
  scorecard(): readonly ScoreLine[] { return this.#round.holeScores.map((score) => scoreLine(this.courseHole(score), score)); }
  holeScore(): number { return this.#played + this.#penalties; }
  roundScore(): number { const completed = this.scorecard().reduce((sum, score) => sum + score.holeScore, 0); return this.#round.holeScores.length > this.#round.currentHoleIndex ? completed : completed + this.holeScore(); }
  holeSummary(): HoleSummary | null { if (this.#base.kind !== "hole-summary" && this.#base.kind !== "round-summary") return null; const score = this.scorecard().at(-1); return score === undefined ? null : { text: "It's in the hole!", score, roundScore: this.scorecard().reduce((sum, line) => sum + line.holeScore, 0) }; }
  roundSummary(): RoundSummary | null { if (this.#base.kind !== "round-summary") return null; const scorecard = this.scorecard(); return { scorecard, roundScore: scorecard.reduce((sum, line) => sum + line.holeScore, 0), totalPar: scorecard.reduce((sum, line) => sum + line.par, 0) }; }

  resize(width: number, height: number): void {
    const undersized = width < 60 || height < 20; if (undersized === this.#suspended) return;
    if (undersized) { this.#suspended = true; this.#suspendedAt = this.now(); this.#presentation?.freeze?.(); return; }
    const frozen = this.#suspendedAt; this.#suspended = false; this.#suspendedAt = null;
    if (frozen !== null) this.#base = shiftTimedState(this.#base, this.now() - frozen);
    this.#presentation?.resume?.();
  }
  tick(): void {
    if (this.#suspended || this.#closed) return; const now = this.now(); const state = this.#base;
    if (state.kind === "intro" && now - state.beganAt >= TIMING.introMilliseconds) this.#base = { kind: "aiming" };
    else if (state.kind === "penalty-notice" && now - state.beganAt >= TIMING.displayTimerMilliseconds) { this.#presentation?.recenter?.(this.#round.lie); this.afterLegalBoundary(state.queued); }
    else if (state.kind === "playback" && now - state.beganAt >= Math.ceil(state.shot.elapsed * 1000)) this.afterPlayback();
  }
  key(key: string, eventTime = this.now(), repeat = false): void {
    if (this.#suspended || this.#closed) return;
    if (key === "H") { this.#hudVisible = !this.#hudVisible; return; }
    const state = this.#base;
    if (state.kind === "aiming") return this.aimingKey(key, eventTime, repeat);
    if (state.kind === "metering") return this.meterKey(key, eventTime, repeat);
    if (state.kind === "committing") { if (key === "Escape") this.queue("pause"); else if (key === "Q") this.queue("abandon"); else if ((key === " " || key === "Enter") && state.error !== null && !repeat) this.commit(state); return; }
    if (state.kind === "playback" || state.kind === "penalty-notice") { if (key === "Escape") this.queue("pause"); else if (key === "Q") this.queue("abandon"); return; }
    if (state.kind === "hole-summary") { if (key === " " || key === "Enter") this.advanceHole(); else if (key === "Escape") this.closeCheckpoint("hole-summary"); return; }
    if (state.kind === "round-summary") { if (key === "Escape") this.closeTerminal("complete"); else if (key === "R") this.replace(); return; }
    if (state.kind === "confirm-abandon") { if (key === "Y" || key === "Enter") this.closeTerminal("abandoned"); else if (key === "N" || key === "Escape") this.#base = shiftTimedState(state.prior, this.now() - state.beganAt); }
  }
  private aimingKey(key: string, eventTime: number, repeat: boolean): void {
    if (key === "ArrowLeft") this.setAim(selectAdjacentDirection(this.#round.shotDirectionIndex, -1));
    else if (key === "ArrowRight") this.setAim(selectAdjacentDirection(this.#round.shotDirectionIndex, 1));
    else if (key === "ArrowUp") this.setClub(selectAdjacentClub(this.#round.selectedClub, -1));
    else if (key === "ArrowDown") this.setClub(selectAdjacentClub(this.#round.selectedClub, 1));
    else if (key === "Tab") this.#presentation?.tab?.();
    else if ((key === " " || key === "Enter") && !repeat) this.#base = { kind: "metering", beganAt: eventTime, requiresNewPress: true };
    else if (key === "Escape") this.closeCheckpoint("aiming");
    else if (key === "Q") this.confirm({ kind: "aiming" });
  }
  private meterKey(key: string, eventTime: number, repeat: boolean): void {
    const state = this.#base; if (state.kind !== "metering") return;
    if (key === "Escape") { this.#base = { kind: "aiming" }; this.closeCheckpoint("aiming"); }
    else if (key === "Q") this.confirm(state);
    else if (key === "release") this.#base = { ...state, requiresNewPress: false };
    else if ((key === " " || key === "Enter") && !repeat && !state.requiresNewPress) this.startCommit(eventTime);
  }
  private startCommit(eventTime: number): void {
    const state = this.#base; if (state.kind !== "metering" || this.#commitPromise !== null) return;
    const power = POWER_LEVELS[meterBlocksAt(eventTime - state.beganAt) - 1]; if (power === undefined) throw new Error("Invalid meter Power.");
    const shotId = this.#shotId(); const shot = this.#resolve(power); if (shot.shotId !== shotId) throw new Error("Resolved Shot identity must match assigned Shot ID.");
    const next = this.nextAfterShot(shot); this.#base = { kind: "committing", shotId, shot, next, queued: null, error: null }; this.commit(this.#base);
  }
  private commit(state: Extract<GameBaseState, { readonly kind: "committing" }>): void {
    if (this.#commitPromise !== null) return;
    const work = this.#writer.commitShot(toDurableShot(state.shot), state.next).then(() => {
      if (this.#base.kind !== "committing" || this.#base.shotId !== state.shotId) return;
      const queued = this.#base.queued; this.#round = state.next; this.#played = state.shot.resultingRound.playedStrokes; this.#penalties = state.shot.resultingRound.penaltyStrokes;
      if (queued === "pause") { this.#closed = true; return; }
      this.#base = { kind: "playback", shot: state.shot, beganAt: this.now(), queued }; this.#presentation?.playback?.(state.shot);
    }, () => { if (this.#base.kind === "committing" && this.#base.shotId === state.shotId) this.#base = { ...state, queued: this.#base.queued, error: "Could not save Shot. Press Space or Enter to retry." }; }).finally(() => { this.#commitPromise = null; });
    this.#commitPromise = work;
  }
  private afterPlayback(): void {
    const state = this.#base; if (state.kind !== "playback") return;
    if (state.shot.terminal === "cup") { if (state.queued === "pause") this.#closed = true; else if (state.queued === "abandon") this.confirm({ kind: "hole-summary" }); else this.#base = { kind: "hole-summary" }; return; }
    if (state.shot.terminal === "water" || state.shot.terminal === "out-of-bounds") { this.#base = { kind: "penalty-notice", terminal: state.shot.terminal, beganAt: this.now(), queued: state.queued }; return; }
    this.afterLegalBoundary(state.queued);
  }
  private afterLegalBoundary(queued: QueuedAction): void { if (queued === "pause") this.#closed = true; else if (queued === "abandon") this.confirm({ kind: "aiming" }); else { this.#base = { kind: "aiming" }; this.#presentation?.recenter?.(this.#round.lie); } }
  private queue(action: Exclude<QueuedAction, null>): void { if (this.#base.kind === "committing" || this.#base.kind === "playback" || this.#base.kind === "penalty-notice") this.#base = { ...this.#base, queued: this.#base.queued ?? action }; }
  private confirm(prior: Exclude<GameBaseState, { readonly kind: "confirm-abandon" }>): void { this.#base = { kind: "confirm-abandon", prior, beganAt: this.now() }; }
  private setAim(direction: ShotDirectionIndex): void { this.#round = { ...this.#round, shotDirectionIndex: direction }; this.#presentation?.changedAim?.(this.#round.lie); }
  private setClub(selectedClub: Club): void { this.#round = { ...this.#round, selectedClub }; this.#presentation?.changedAim?.(this.#round.lie); }
  private nextAfterShot(shot: ResolvedShot): PersistedRoundState {
    const hole = this.hole(); if (shot.terminal !== "cup") return { ...this.#round, lie: { ...shot.resultingRound.lie } };
    const id = parseHoleId(hole.id); const number = parseHoleNumber(hole.number); const courseIndex = parseCourseHoleIndex(this.#round.currentHoleIndex);
    if (id === undefined || number === undefined || courseIndex === undefined) throw new Error("Invalid Course Hole reference.");
    return { ...this.#round, lie: { ...hole.cup }, holeScores: [...this.#round.holeScores, { hole: { id, number, courseIndex }, playedStrokes: shot.resultingRound.playedStrokes, penaltyStrokes: shot.resultingRound.penaltyStrokes, completed: true }] };
  }
  private advanceHole(): void {
    if (this.#advancePromise !== null || this.#base.kind !== "hole-summary") return;
    const nextHole = this.#course.holes[this.#round.currentHoleIndex + 1];
    if (nextHole === undefined) { this.#base = { kind: "round-summary" }; return; }
    const index = parseCourseHoleIndex(this.#round.currentHoleIndex + 1); const direction = parseShotDirectionIndex(quantizeShotDirection(bearingToward(nextHole.tee, nextHole.cup)));
    if (index === undefined || direction === undefined) throw new Error("Next Hole is invalid.");
    const next = { ...this.#round, currentHoleIndex: index, lie: { ...nextHole.tee }, selectedClub: "driver" as const, shotDirectionIndex: direction };
    const work = this.#writer.append({ kind: "checkpoint", payload: { state: next, lifecycle: "aiming" } }).then(() => { if (this.#base.kind === "hole-summary") { this.#round = next; this.#played = 0; this.#penalties = 0; this.#base = { kind: "intro", beganAt: this.now() }; this.#presentation?.aim?.(next.lie); } }).finally(() => { this.#advancePromise = null; }); this.#advancePromise = work;
  }
  private closeCheckpoint(lifecycle: "aiming" | "hole-summary"): void {
    if (this.#checkpointPromise !== null || this.#closed) return;
    const work = this.#writer.append({ kind: "checkpoint", payload: { state: this.#round, lifecycle } }).then(() => { this.#closed = true; }).finally(() => { this.#checkpointPromise = null; }); this.#checkpointPromise = work;
  }
  private closeTerminal(status: "complete" | "abandoned"): void {
    if (this.#terminalPromise !== null || this.#closed) return;
    const next = { ...this.#round, status } as PersistedRoundState;
    const work = this.#writer.append({ kind: "round-terminal", payload: { status, state: next } }).then(() => { this.#round = next; this.#closed = true; }).finally(() => { this.#terminalPromise = null; }); this.#terminalPromise = work;
  }
  private replace(): void { if (this.#replacementPromise !== null || this.#replaceRound === undefined) return; const work = this.#replaceRound().finally(() => { this.#replacementPromise = null; }); this.#replacementPromise = work; }
  private hole(): CourseHole { const hole = this.#course.holes[this.#round.currentHoleIndex]; if (hole === undefined) throw new Error("Current Hole is missing."); return hole; }
  private courseHole(score: PersistedHoleScore): CourseHole { const hole = this.#course.holes[score.hole.courseIndex]; if (hole === undefined || hole.id !== score.hole.id || hole.number !== score.hole.number) throw new Error("Missing scored Hole."); return hole; }
  private now(): number { return this.#clock.now(); }
}

export function meterBlocksAt(activeMilliseconds: number): number { if (!Number.isFinite(activeMilliseconds) || activeMilliseconds < 0) throw new RangeError("Meter active time must be finite and non-negative."); const bin = Math.floor((activeMilliseconds % 3_000) / TIMING.powerMeterBinMilliseconds); return bin < 10 ? bin + 1 : 20 - bin; }
export function renderPowerMeter(blocks: number): { readonly blocks: string; readonly color: "#ed8796" } { if (!Number.isInteger(blocks) || blocks < 1 || blocks > 10) throw new RangeError("Meter blocks must be 1 through 10."); return { blocks: "█".repeat(blocks), color: POWER_METER.color }; }
function scoreLine(hole: CourseHole, score: PersistedHoleScore): ScoreLine { return { holeNumber: hole.number, par: hole.par, playedStrokes: score.playedStrokes, penaltyStrokes: score.penaltyStrokes, holeScore: score.playedStrokes + score.penaltyStrokes }; }
function timedBeganAt(state: GameBaseState): number | null { return state.kind === "intro" || state.kind === "metering" || state.kind === "playback" || state.kind === "penalty-notice" || state.kind === "confirm-abandon" ? state.beganAt : null; }
function shiftTimedState(state: GameBaseState, suspendedMilliseconds: number): GameBaseState { const beganAt = timedBeganAt(state); if (beganAt === null) return state; if (state.kind === "confirm-abandon") return { ...state, beganAt: beganAt + suspendedMilliseconds, prior: shiftTimedState(state.prior, suspendedMilliseconds) as Exclude<GameBaseState, { readonly kind: "confirm-abandon" }> }; return { ...state, beganAt: beganAt + suspendedMilliseconds } as GameBaseState; }
