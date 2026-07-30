import type { MonotonicClock, Point } from "../domain/index.ts";
import { TIMING } from "../domain/index.ts";

export type CameraMode = "lie" | "target" | "playback";
export interface CameraPosition { readonly x: number; readonly y: number; }

function smoothstep(t: number): number { const bounded = Math.min(1, Math.max(0, t)); return bounded * bounded * (3 - 2 * bounded); }
function interpolate(from: CameraPosition, to: CameraPosition, amount: number): CameraPosition {
  return { x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount };
}

/** Transient camera state. Sampling it never schedules work, so stale callbacks are impossible. */
export class CameraController {
  #mode: CameraMode = "lie";
  #lie: CameraPosition;
  #target: CameraPosition;
  #ball: CameraPosition;
  #aimStartedAt: number;
  #frozenAt: number | undefined;

  constructor(private readonly clock: MonotonicClock, lie: Point, target: Point) {
    this.#lie = { ...lie }; this.#target = { ...target }; this.#ball = { ...lie }; this.#aimStartedAt = clock.now();
  }

  get mode(): CameraMode { return this.#mode; }
  aim(lie: Point, target: Point): void { this.#mode = "lie"; this.#lie = { ...lie }; this.#target = { ...target }; this.#aimStartedAt = this.now(); }
  tab(): void { this.#mode = this.#mode === "target" ? "lie" : "target"; }
  changedAim(lie: Point, target: Point): void { this.aim(lie, target); }
  followBall(ball: Point): void { this.#mode = "playback"; this.#ball = { ...ball }; }
  recenter(lie: Point): void { this.#lie = { ...lie }; this.#mode = "lie"; this.#aimStartedAt = this.now(); }
  freezeForResize(): void { if (this.#frozenAt === undefined) this.#frozenAt = this.clock.now(); }
  resumeFromResize(): void { if (this.#frozenAt !== undefined) { this.#aimStartedAt += this.clock.now() - this.#frozenAt; this.#frozenAt = undefined; } }
  position(): CameraPosition {
    if (this.#mode === "playback") return { ...this.#ball };
    if (this.#mode === "target") return { ...this.#target };
    const elapsed = this.now() - this.#aimStartedAt;
    if (elapsed <= TIMING.targetPanDelayMilliseconds) return { ...this.#lie };
    return interpolate(this.#lie, this.#target, smoothstep((elapsed - TIMING.targetPanDelayMilliseconds) / TIMING.targetPanDurationMilliseconds));
  }
  private now(): number { return this.#frozenAt ?? this.clock.now(); }
}

export { smoothstep };
