import { describe, expect, it } from "vitest";
import { FakeTimers } from "../capture/testUtils";
import { createCursorPollHook } from "./cursorPollHook";
import { TelemetryCollector } from "./telemetry";

function setup(sampleHz?: number) {
  const timers = new FakeTimers();
  let point: { x: number; y: number } | Error = { x: 10, y: 20 };
  let polls = 0;
  const hook = createCursorPollHook({
    timers,
    sampleHz,
    getCursorPoint: () => {
      polls++;
      if (point instanceof Error) throw point;
      return point;
    },
  });
  return {
    timers,
    hook,
    get polls() {
      return polls;
    },
    move: (p: { x: number; y: number } | Error) => {
      point = p;
    },
  };
}

describe("cursor poll hook", () => {
  it("does not poll until a mousemove listener subscribes, and stops after the last leaves", () => {
    const t = setup(100);
    t.timers.advance(1000);
    expect(t.polls).toBe(0);
    const seen: { x: number; y: number }[] = [];
    const off = t.hook.on("mousemove", (e) => seen.push(e));
    expect(seen).toEqual([{ x: 10, y: 20 }]);
    off();
    const before = t.polls;
    t.timers.advance(1000);
    expect(t.polls).toBe(before);
    expect(t.timers.pendingCount).toBe(0);
  });

  it("emits only when the position changes, at the sample rate", () => {
    const t = setup(100);
    const seen: { x: number; y: number }[] = [];
    t.hook.on("mousemove", (e) => seen.push(e));
    t.timers.advance(50); // 5 polls, same point
    t.move({ x: 11, y: 20 });
    t.timers.advance(10);
    t.timers.advance(10);
    expect(seen).toEqual([
      { x: 10, y: 20 },
      { x: 11, y: 20 },
    ]);
    expect(t.polls).toBe(8);
  });

  it("never emits clicks, keys or scrolls (privacy) and survives a throwing screen API", () => {
    const t = setup();
    let other = 0;
    t.hook.on("mousedown", () => other++);
    t.hook.on("keydown", () => other++);
    t.hook.on("wheel", () => other++);
    const seen: unknown[] = [];
    t.hook.on("mousemove", (e) => seen.push(e));
    t.move(new Error("display gone"));
    t.timers.advance(100);
    t.move({ x: Number.NaN, y: 1 });
    t.timers.advance(100);
    t.move({ x: 5, y: 5 });
    t.timers.advance(100);
    expect(seen).toEqual([
      { x: 10, y: 20 },
      { x: 5, y: 5 },
    ]);
    expect(other).toBe(0);
  });

  it("invalid sample rates fall back to 120 Hz", () => {
    const t = setup(-3);
    t.hook.on("mousemove", () => {});
    t.timers.advance(1000);
    expect(t.polls).toBeGreaterThanOrEqual(120);
    expect(t.polls).toBeLessThanOrEqual(121);
  });

  it("feeds the telemetry collector, which unsubscribes (stopping the poll) on stop", () => {
    const t = setup(120);
    let ns = 0n;
    const collector = new TelemetryCollector({
      hook: t.hook,
      nowNs: () => ns,
      origin: "display",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      scaleFactor: 1,
    });
    collector.start();
    ns = 1_000_000_000n;
    t.move({ x: 50, y: 25 });
    t.timers.advance(10);
    collector.stop();
    expect(t.timers.pendingCount).toBe(0);
    const file = collector.finalize({ firstFramePtsNs: 0n, keepTypedText: false });
    expect(file.points.at(-1)).toEqual([1000, 0.5, 0.25, "arrow"]);
    expect(file.keys).toEqual([]);
  });
});
