import { performance } from "node:perf_hooks";

/** A monotonic millisecond source injected into simulation and presentation timing. */
export interface MonotonicClock {
  now(): number;
}

function requireFiniteNonnegative(value: number, description: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${description} must be a finite, nonnegative number.`);
  }
}

/** Production monotonic source. Unlike wall-clock time, it is unaffected by clock changes. */
export class SystemMonotonicClock implements MonotonicClock {
  now(): number {
    return performance.now();
  }
}

/** Controllable source for deterministic simulation and timer tests. */
export class ManualMonotonicClock implements MonotonicClock {
  #now: number;

  constructor(initialMilliseconds = 0) {
    requireFiniteNonnegative(initialMilliseconds, "Initial monotonic time");
    this.#now = initialMilliseconds;
  }

  now(): number {
    return this.#now;
  }

  advanceBy(milliseconds: number): void {
    requireFiniteNonnegative(milliseconds, "Monotonic clock advance");
    const nextTime = this.#now + milliseconds;
    if (!Number.isFinite(nextTime)) {
      throw new RangeError("Monotonic time must remain finite.");
    }
    this.#now = nextTime;
  }

  advanceTo(milliseconds: number): void {
    requireFiniteNonnegative(milliseconds, "Monotonic clock target");
    if (milliseconds < this.#now) {
      throw new RangeError("A monotonic clock cannot move backwards.");
    }
    this.#now = milliseconds;
  }
}

export const ACTIVE_TIME_SUSPENSION_REASONS = ["resize", "confirmation"] as const;
export type ActiveTimeSuspensionReason = (typeof ACTIVE_TIME_SUSPENSION_REASONS)[number];

/**
 * Converts an injected monotonic source to active time. Active time advances only
 * while no suspension reason is present; nested reasons cannot resume it early.
 */
export class ActiveTimeClock implements MonotonicClock {
  readonly kind = "transient-active-clock" as const;
  readonly #source: MonotonicClock;
  readonly #suspensions = new Set<ActiveTimeSuspensionReason>();
  #lastSourceTime: number;
  #activeMilliseconds = 0;

  constructor(source: MonotonicClock) {
    this.#source = source;
    this.#lastSourceTime = source.now();
    requireFiniteNonnegative(this.#lastSourceTime, "Monotonic source time");
  }

  now(): number {
    this.#sample();
    return this.#activeMilliseconds;
  }

  suspend(reason: ActiveTimeSuspensionReason): void {
    this.#sample();
    this.#suspensions.add(reason);
  }

  resume(reason: ActiveTimeSuspensionReason): void {
    this.#sample();
    this.#suspensions.delete(reason);
  }

  isSuspended(reason?: ActiveTimeSuspensionReason): boolean {
    return reason === undefined ? this.#suspensions.size > 0 : this.#suspensions.has(reason);
  }

  #sample(): void {
    const sourceTime = this.#source.now();
    requireFiniteNonnegative(sourceTime, "Monotonic source time");
    if (sourceTime < this.#lastSourceTime) {
      throw new RangeError("Injected monotonic source moved backwards.");
    }
    if (this.#suspensions.size === 0) {
      this.#activeMilliseconds += sourceTime - this.#lastSourceTime;
    }
    this.#lastSourceTime = sourceTime;
  }
}

export const PRESENTATION_TIMER_NAMES = [
  "meter",
  "camera",
  "intro",
  "notice",
  "playback",
] as const;
export type PresentationTimerName = (typeof PRESENTATION_TIMER_NAMES)[number];

/** Transient clocks for every independently testable presentation timer. */
export class PresentationClockSet {
  readonly kind = "transient-clock-set" as const;
  readonly meter: ActiveTimeClock;
  readonly camera: ActiveTimeClock;
  readonly intro: ActiveTimeClock;
  readonly notice: ActiveTimeClock;
  readonly playback: ActiveTimeClock;

  constructor(source: MonotonicClock) {
    this.meter = new ActiveTimeClock(source);
    this.camera = new ActiveTimeClock(source);
    this.intro = new ActiveTimeClock(source);
    this.notice = new ActiveTimeClock(source);
    this.playback = new ActiveTimeClock(source);
  }

  suspend(reason: ActiveTimeSuspensionReason): void {
    for (const timerName of PRESENTATION_TIMER_NAMES) this[timerName].suspend(reason);
  }

  resume(reason: ActiveTimeSuspensionReason): void {
    for (const timerName of PRESENTATION_TIMER_NAMES) this[timerName].resume(reason);
  }
}
