import type { MonotonicClock, Point } from "../domain/index.ts";

export type PlaybackTerminal = "cup" | "water" | "out-of-bounds" | "rest";
export interface PlaybackKeyframe { readonly atMilliseconds: number; readonly position: Point; readonly speed: number; }
export interface ResolvedPlayback { readonly shotId: string; readonly keyframes: readonly PlaybackKeyframe[]; readonly terminal: PlaybackTerminal; }
export interface PlaybackFrame { readonly position: Point; readonly speed: number; readonly complete: boolean; readonly notice?: "Hole complete" | "Water hazard" | "Out of Bounds"; }

/** Interpolates immutable resolved keyframes. It owns no Round or persistence reference. */
export class ResolvedShotPlayback {
  #startedAt: number | undefined;
  constructor(private readonly clock: MonotonicClock, private readonly resolved: ResolvedPlayback) {
    if (resolved.keyframes.length === 0) throw new RangeError("Playback requires at least one keyframe.");
    for (let index = 1; index < resolved.keyframes.length; index++) {
      const current = resolved.keyframes[index]; const previous = resolved.keyframes[index - 1];
      if (current === undefined || previous === undefined) throw new Error("Playback keyframe lookup failed.");
      if (current.atMilliseconds < previous.atMilliseconds) throw new RangeError("Playback keyframes must be ordered.");
    }
  }
  start(): void { this.#startedAt = this.clock.now(); }
  frame(): PlaybackFrame {
    if (this.#startedAt === undefined) throw new Error("Playback has not started.");
    const elapsed = Math.max(0, this.clock.now() - this.#startedAt);
    const last = this.resolved.keyframes.at(-1);
    if (last === undefined) throw new Error("Playback keyframe lookup failed.");
    if (elapsed >= last.atMilliseconds) return { position: { ...last.position }, speed: last.speed, complete: true, ...this.notice() };
    const nextIndex = this.resolved.keyframes.findIndex((frame) => frame.atMilliseconds > elapsed);
    const next = this.resolved.keyframes[nextIndex]; const previous = this.resolved.keyframes[nextIndex - 1];
    if (next === undefined || previous === undefined) throw new Error("Playback keyframe lookup failed.");
    const ratio = (elapsed - previous.atMilliseconds) / (next.atMilliseconds - previous.atMilliseconds);
    return { position: { x: previous.position.x + (next.position.x - previous.position.x) * ratio, y: previous.position.y + (next.position.y - previous.position.y) * ratio }, speed: previous.speed + (next.speed - previous.speed) * ratio, complete: false };
  }
  private notice(): Partial<Pick<PlaybackFrame, "notice">> {
    return this.resolved.terminal === "cup" ? { notice: "Hole complete" } : this.resolved.terminal === "water" ? { notice: "Water hazard" } : this.resolved.terminal === "out-of-bounds" ? { notice: "Out of Bounds" } : {};
  }
}
