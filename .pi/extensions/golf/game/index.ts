import {
  POWER_LEVELS, POWER_METER, TIMING, parseCourseHoleIndex, parseHoleId, parseHoleNumber,
  type Club, type MonotonicClock, type PersistedHoleScore, type PersistedRoundState, type Power,
  type ShotDirectionIndex,
} from "../domain/index.ts";
import { bearingToward, quantizeShotDirection, selectAdjacentClub, selectAdjacentDirection } from "../simulation/inputs.ts";
import type { DurableResolvedShot, ResolvedShot } from "../simulation/outcome.ts";
import type { Course, CourseHole } from "../course-loader/types.ts";

/** The authoritative V2-T10 base-state discriminated union names. */
export const GAME_BASE_STATES = ["intro", "aiming", "metering", "committing", "playback", "penalty-notice", "hole-summary", "round-summary", "confirm-abandon"] as const;
export type GameBaseStateName = (typeof GAME_BASE_STATES)[number];
export type QueuedAction = "pause" | "abandon" | null;
export type GameBaseState =
  | { readonly kind: "intro"; readonly beganAt: number }
  | { readonly kind: "aiming" }
  | { readonly kind: "metering"; readonly beganAt: number; readonly requiresNewPress: boolean }
  | { readonly kind: "committing"; readonly shotId: string; readonly shot: ResolvedShot; readonly next: PersistedRoundState; readonly queued: QueuedAction; readonly error: string | null }
  | { readonly kind: "playback"; readonly shot: ResolvedShot; readonly beganAt: number; readonly queued: QueuedAction }
  | { readonly kind: "penalty-notice"; readonly terminal: "water" | "out-of-bounds"; readonly beganAt: number; readonly queued: QueuedAction }
  | { readonly kind: "hole-summary" }
  | { readonly kind: "round-summary" }
  | { readonly kind: "confirm-abandon"; readonly prior: Exclude<GameBaseState, { readonly kind: "confirm-abandon" }>; readonly priorBeganAt: number | null; readonly beganAt: number };
export type GameState = GameBaseState | { readonly kind: "resize-paused"; readonly suspended: GameBaseState };

export interface GameWriter {
  commitShot(shot: DurableResolvedShot, state: PersistedRoundState): Promise<number>;
  append(entry: { readonly kind: "checkpoint"; readonly payload: { readonly state: PersistedRoundState; readonly lifecycle: "aiming" | "hole-summary" } } | { readonly kind: "round-terminal"; readonly payload: { readonly status: "complete" | "abandoned"; readonly state: PersistedRoundState } }): Promise<number>;
}
export interface GameControllerOptions {
  readonly course: Course;
  readonly state: PersistedRoundState;
  readonly writer: GameWriter;
  readonly clock: MonotonicClock;
  readonly shotId: () => string;
  readonly resolve: (power: Power) => ResolvedShot;
  /** T11 supplies the durable T09 replacement transaction; this component never selects Courses. */
  readonly replaceRound?: () => Promise<void>;
  /** Recovery deliberately discards every transient intro, notice, meter, and playback. */
  readonly resumed?: boolean;
}
export interface ScoreLine { readonly holeNumber: number; readonly par: number; readonly playedStrokes: number; readonly penaltyStrokes: number; readonly holeScore: number; }

/**
 * Narrow non-rendering component API.  It owns transient UI state only; T09 owns
 * durable validation/append and T08 consumes the resolved playback descriptor.
 */
export class GameController {
  #base: GameBaseState;
  #suspended = false;
  #suspendedAt: number | null = null;
  #round: PersistedRoundState;
  #played = 0;
  #penalties = 0;
  #hudVisible = true;
  #closed = false;
  #commitSerial = 0;
  readonly #course: Course;
  readonly #writer: GameWriter;
  readonly #clock: MonotonicClock;
  readonly #shotId: () => string;
  readonly #resolve: (power: Power) => ResolvedShot;
  readonly #replaceRound: (() => Promise<void>) | undefined;

  constructor(options: GameControllerOptions) {
    this.#course = options.course; this.#round = options.state; this.#writer = options.writer;
    this.#clock = options.clock; this.#shotId = options.shotId; this.#resolve = options.resolve; this.#replaceRound = options.replaceRound;
    this.#base = options.resumed === true ? { kind: "aiming" } : { kind: "intro", beganAt: this.now() };
  }
  get state(): GameState { return this.#suspended ? { kind: "resize-paused", suspended: this.#base } : this.#base; }
  get round(): PersistedRoundState { return this.#round; }
  get closed(): boolean { return this.#closed; }
  get hudVisible(): boolean { return this.#hudVisible; }
  get meterBlocks(): number { return this.#base.kind === "metering" ? meterBlocksAt(this.now() - this.#base.beganAt) : POWER_METER.minimumBlocks; }
  get introText(): string { const hole = this.hole(); return `${this.#course.name} — Hole ${hole.number} — Par ${hole.par}`; }
  get confirmationText(): string { return "Abandon the active Round?"; }
  scorecard(): readonly ScoreLine[] { return this.#round.holeScores.map((score) => { const hole = this.#course.holes[score.hole.courseIndex]; if (hole === undefined) throw new Error("Missing scored Hole."); return scoreLine(hole, score); }); }
  roundScore(): number { return this.scorecard().reduce((sum, score) => sum + score.holeScore, 0); }
  holeScore(): number { return this.#played + this.#penalties; }
  resize(width: number, height: number): void {
    const undersized = width < 60 || height < 20;
    if (undersized === this.#suspended) return;
    if (undersized) { this.#suspended = true; this.#suspendedAt = this.now(); return; }
    const suspendedAt = this.#suspendedAt;
    this.#suspended = false; this.#suspendedAt = null;
    if (suspendedAt !== null) this.#base = shiftTimedState(this.#base, this.now() - suspendedAt);
  }
  tick(): void {
    if (this.#suspended || this.#closed) return;
    const now = this.now();
    if (this.#base.kind === "intro" && now - this.#base.beganAt >= TIMING.introMilliseconds) this.#base = { kind: "aiming" };
    else if (this.#base.kind === "penalty-notice" && now - this.#base.beganAt >= TIMING.displayTimerMilliseconds) this.afterLegalBoundary(this.#base.queued);
    else if (this.#base.kind === "playback" && now - this.#base.beganAt >= Math.ceil(this.#base.shot.elapsed * 1000)) this.afterPlayback();
  }
  key(key: string, eventTime = this.now(), repeat = false): void {
    if (this.#suspended || this.#closed) return;
    if (key === "H") { this.#hudVisible = !this.#hudVisible; return; }
    const state = this.#base;
    if (state.kind === "intro") return;
    if (state.kind === "aiming") { this.aimingKey(key, eventTime, repeat); return; }
    if (state.kind === "metering") { this.meterKey(key, eventTime, repeat); return; }
    if (state.kind === "committing") { if (key === "Escape") this.queue("pause"); else if (key === "Q") this.queue("abandon"); else if ((key === " " || key === "Enter") && state.error !== null) this.commit(state); return; }
    if (state.kind === "playback" || state.kind === "penalty-notice") { if (key === "Escape") this.queue("pause"); else if (key === "Q") this.queue("abandon"); return; }
    if (state.kind === "hole-summary") { if (key === " " || key === "Enter") void this.advanceHole(); else if (key === "Escape") void this.closeCheckpoint("hole-summary"); return; }
    if (state.kind === "round-summary") { if (key === "Escape") void this.closeTerminal("complete"); else if (key === "R" && this.#replaceRound !== undefined) void this.#replaceRound(); return; }
    if (state.kind === "confirm-abandon") { if (key === "Y" || key === "Enter") void this.closeTerminal("abandoned"); else if (key === "N" || key === "Escape") this.#base = shiftTimedState(state.prior, this.now() - state.beganAt); }
  }
  private aimingKey(key: string, eventTime: number, repeat: boolean): void {
    if (key === "ArrowLeft") this.setAim(selectAdjacentDirection(this.#round.shotDirectionIndex, -1));
    else if (key === "ArrowRight") this.setAim(selectAdjacentDirection(this.#round.shotDirectionIndex, 1));
    else if (key === "ArrowUp") this.setClub(selectAdjacentClub(this.#round.selectedClub, -1));
    else if (key === "ArrowDown") this.setClub(selectAdjacentClub(this.#round.selectedClub, 1));
    else if (key === " " || key === "Enter") { if (!repeat) this.#base = { kind: "metering", beganAt: eventTime, requiresNewPress: true }; }
    else if (key === "Escape") void this.closeCheckpoint("aiming");
    else if (key === "Q") this.confirm({ kind: "aiming" });
  }
  private meterKey(key: string, eventTime: number, repeat: boolean): void {
    const state = this.#base; if (state.kind !== "metering") return;
    if (key === "Escape") { this.#base = { kind: "aiming" }; void this.closeCheckpoint("aiming"); return; }
    if (key === "Q") { this.confirm(state); return; }
    if (key === "release") { this.#base = { ...state, requiresNewPress: false }; return; }
    if ((key === " " || key === "Enter") && !repeat && !state.requiresNewPress) this.startCommit(eventTime);
  }
  private startCommit(eventTime: number): void {
    const state = this.#base; if (state.kind !== "metering") return;
    const blocks = meterBlocksAt(eventTime - state.beganAt); const power = POWER_LEVELS[blocks - 1];
    if (power === undefined) throw new Error("Invalid meter Power.");
    const shot = this.#resolve(power); const next = this.nextAfterShot(shot); const shotId = this.#shotId();
    if (shot.shotId !== shotId) throw new Error("Resolved Shot identity must match assigned Shot ID.");
    this.#base = { kind: "committing", shotId, shot, next, queued: null, error: null }; this.commit(this.#base);
  }
  private commit(state: Extract<GameBaseState, { readonly kind: "committing" }>): void {
    const serial = ++this.#commitSerial;
    void this.#writer.commitShot(stripShot(state.shot), state.next).then(() => {
      if (serial !== this.#commitSerial || this.#base.kind !== "committing") return;
      const queued = this.#base.kind === "committing" ? this.#base.queued : state.queued;
      this.#round = state.next; this.#played = state.shot.resultingRound.playedStrokes; this.#penalties = state.shot.resultingRound.penaltyStrokes;
      if (queued === "pause") { this.#closed = true; return; }
      this.#base = { kind: "playback", shot: state.shot, beganAt: this.now(), queued };
    }, () => { if (serial === this.#commitSerial && this.#base.kind === "committing") this.#base = { ...state, error: "Could not save Shot. Press Space or Enter to retry." }; });
  }
  private afterPlayback(): void {
    const state = this.#base; if (state.kind !== "playback") return;
    if (state.shot.terminal === "cup") { if (state.queued === "pause") this.#closed = true; else if (state.queued === "abandon") this.confirm({ kind: "hole-summary" }); else this.#base = { kind: "hole-summary" }; return; }
    if (state.shot.terminal === "water" || state.shot.terminal === "out-of-bounds") { this.#base = { kind: "penalty-notice", terminal: state.shot.terminal, beganAt: this.now(), queued: state.queued }; return; }
    this.afterLegalBoundary(state.queued);
  }
  private afterLegalBoundary(queued: QueuedAction): void { if (queued === "pause") this.#closed = true; else if (queued === "abandon") this.confirm({ kind: "aiming" }); else this.#base = { kind: "aiming" }; }
  private queue(action: Exclude<QueuedAction, null>): void { if (this.#base.kind === "committing" || this.#base.kind === "playback" || this.#base.kind === "penalty-notice") this.#base = { ...this.#base, queued: this.#base.queued ?? action }; }
  private confirm(prior: Exclude<GameBaseState, { readonly kind: "confirm-abandon" }>): void { this.#base = { kind: "confirm-abandon", prior, priorBeganAt: timedBeganAt(prior), beganAt: this.now() }; }
  private setAim(direction: ShotDirectionIndex): void { this.#round = { ...this.#round, shotDirectionIndex: direction }; }
  private setClub(selectedClub: Club): void { this.#round = { ...this.#round, selectedClub }; }
  private nextAfterShot(shot: ResolvedShot): PersistedRoundState {
    const hole = this.hole(); if (shot.terminal !== "cup") return { ...this.#round, lie: shot.resultingRound.lie };
    const id = parseHoleId(hole.id); const number = parseHoleNumber(hole.number); const courseIndex = parseCourseHoleIndex(this.#round.currentHoleIndex);
    if (id === undefined || number === undefined || courseIndex === undefined) throw new Error("Invalid Course Hole reference.");
    const reference = { id, number, courseIndex };
    return { ...this.#round, lie: hole.cup, holeScores: [...this.#round.holeScores, { hole: reference, playedStrokes: shot.resultingRound.playedStrokes, penaltyStrokes: shot.resultingRound.penaltyStrokes, completed: true }] };
  }
  private async advanceHole(): Promise<void> {
    const nextIndex = this.#round.currentHoleIndex + 1; const nextHole = this.#course.holes[nextIndex];
    if (nextHole === undefined) { this.#base = { kind: "round-summary" }; return; }
    const index = parseCourseHoleIndex(nextIndex); const direction = quantizeShotDirection(bearingToward(nextHole.tee, nextHole.cup));
    if (index === undefined) throw new Error("Course exceeds supported Hole count.");
    const next = { ...this.#round, currentHoleIndex: index, lie: nextHole.tee, selectedClub: "driver" as const, shotDirectionIndex: direction };
    await this.#writer.append({ kind: "checkpoint", payload: { state: next, lifecycle: "aiming" } }); this.#round = next; this.#played = 0; this.#penalties = 0; this.#base = { kind: "intro", beganAt: this.now() };
  }
  private async closeCheckpoint(lifecycle: "aiming" | "hole-summary"): Promise<void> { await this.#writer.append({ kind: "checkpoint", payload: { state: this.#round, lifecycle } }); this.#closed = true; }
  private async closeTerminal(status: "complete" | "abandoned"): Promise<void> { const state = { ...this.#round, status }; await this.#writer.append({ kind: "round-terminal", payload: { status, state } }); this.#round = state; this.#closed = true; }
  private hole(): CourseHole { const hole = this.#course.holes[this.#round.currentHoleIndex]; if (hole === undefined) throw new Error("Current Hole is missing."); return hole; }
  private now(): number { return this.#clock.now(); }
}
export function meterBlocksAt(activeMilliseconds: number): number { if (!Number.isFinite(activeMilliseconds) || activeMilliseconds < 0) throw new RangeError("Meter active time must be finite and non-negative."); const bin = Math.floor((activeMilliseconds % 3_000) / TIMING.powerMeterBinMilliseconds); return bin < 10 ? bin + 1 : 20 - bin; }
export function renderPowerMeter(blocks: number): { readonly blocks: string; readonly color: "#ed8796" } { if (!Number.isInteger(blocks) || blocks < 1 || blocks > 10) throw new RangeError("Meter blocks must be 1 through 10."); return { blocks: "█".repeat(blocks), color: POWER_METER.color }; }
function stripShot(shot: ResolvedShot): DurableResolvedShot { return { shotId: shot.shotId, preShotLie: shot.preShotLie, inputs: shot.inputs, landingPosition: shot.landingPosition, finalPosition: shot.finalPosition, terminal: shot.terminal, resultingSpeed: shot.resultingSpeed, elapsed: shot.elapsed, resultingRound: shot.resultingRound }; }
function scoreLine(hole: CourseHole, score: PersistedHoleScore): ScoreLine { return { holeNumber: hole.number, par: hole.par, playedStrokes: score.playedStrokes, penaltyStrokes: score.penaltyStrokes, holeScore: score.playedStrokes + score.penaltyStrokes }; }
function timedBeganAt(state: GameBaseState): number | null { return state.kind === "intro" || state.kind === "metering" || state.kind === "playback" || state.kind === "penalty-notice" ? state.beganAt : null; }
function shiftTimedState(state: GameBaseState, suspendedMilliseconds: number): GameBaseState { const beganAt = timedBeganAt(state); return beganAt === null ? state : { ...state, beganAt: beganAt + suspendedMilliseconds } as GameBaseState; }
