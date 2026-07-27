import { describe, expect, it } from "vitest";

import {
  ActiveTimeClock,
  ManualMonotonicClock,
  PRESENTATION_TIMER_NAMES,
  PresentationClockSet,
  type MonotonicClock,
} from "./clock.ts";

describe("V2-FND-002 deterministic monotonic clocks", () => {
  it("AC-FND-002-04 controls meter, camera, intro, notice, and playback timing deterministically", () => {
    const source = new ManualMonotonicClock(10_000);
    const clocks = new PresentationClockSet(source);

    source.advanceBy(250);
    for (const name of PRESENTATION_TIMER_NAMES) expect(clocks[name].now()).toBe(250);

    clocks.suspend("resize");
    source.advanceBy(5_000);
    for (const name of PRESENTATION_TIMER_NAMES) expect(clocks[name].now()).toBe(250);

    clocks.suspend("confirmation");
    clocks.resume("resize");
    source.advanceBy(1_000);
    for (const name of PRESENTATION_TIMER_NAMES) expect(clocks[name].now()).toBe(250);

    clocks.resume("confirmation");
    source.advanceBy(750);
    for (const name of PRESENTATION_TIMER_NAMES) expect(clocks[name].now()).toBe(1_000);
  });

  it("AC-FND-002-04 samples event time rather than depending on render or wall-clock scheduling", () => {
    const source = new ManualMonotonicClock();
    const activeTime = new ActiveTimeClock(source);

    source.advanceTo(149);
    expect(activeTime.now()).toBe(149);
    source.advanceTo(150);
    expect(activeTime.now()).toBe(150);
    source.advanceTo(1_500);
    expect(activeTime.now()).toBe(1_500);
    source.advanceTo(3_000);
    expect(activeTime.now()).toBe(3_000);
  });

  it("AC-FND-002-04 rejects invalid or backwards clock input at the injected boundary", () => {
    expect(() => new ManualMonotonicClock(-1)).toThrow(RangeError);
    const manual = new ManualMonotonicClock(5);
    expect(() => manual.advanceBy(Number.NaN)).toThrow(RangeError);
    expect(() => manual.advanceTo(4)).toThrow("cannot move backwards");

    let sourceTime = 10;
    const source: MonotonicClock = { now: () => sourceTime };
    const activeTime = new ActiveTimeClock(source);
    sourceTime = 9;
    expect(() => activeTime.now()).toThrow("moved backwards");
  });
});
