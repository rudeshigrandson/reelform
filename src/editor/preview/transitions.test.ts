import { describe, expect, it } from "vitest";
import { DEFAULT_EFFECTS_SETTINGS } from "../inspector/effects/types";
import type { Clip } from "../model/schema";
import {
  CUT_ZOOM_PEAK,
  clipBoundaries,
  transitionAt,
  transitionInputFrom,
  upcomingIncomingSourceMs,
} from "./transitions";

describe("upcomingIncomingSourceMs", () => {
  const seq: Clip[] = [
    { id: "b", sourceStartMs: 5000, sourceEndMs: 6000, timelineStartMs: 2000 },
    { id: "a", sourceStartMs: 0, sourceEndMs: 2000, timelineStartMs: 0 },
    { id: "c", sourceStartMs: 9000, sourceEndMs: 12_000, timelineStartMs: 3000 },
  ];
  it("returns the next boundary's incoming first frame, null after the last", () => {
    expect(upcomingIncomingSourceMs(seq, 0)).toBe(5000);
    expect(upcomingIncomingSourceMs(seq, 1999)).toBe(5000);
    expect(upcomingIncomingSourceMs(seq, 2000)).toBe(9000);
    expect(upcomingIncomingSourceMs(seq, 3000)).toBeNull();
    expect(upcomingIncomingSourceMs(null, 0)).toBeNull();
    expect(upcomingIncomingSourceMs(seq, Number.NaN)).toBeNull();
  });
});

const clips: Clip[] = [
  { id: "b", sourceStartMs: 5000, sourceEndMs: 6000, timelineStartMs: 2000 },
  { id: "a", sourceStartMs: 0, sourceEndMs: 2000, timelineStartMs: 0 },
  { id: "c", sourceStartMs: 9000, sourceEndMs: 12_000, timelineStartMs: 3000 },
];

describe("clipBoundaries", () => {
  it("lists boundaries in timeline order", () => {
    expect(clipBoundaries(clips).map((b) => [b.atMs, b.outgoing.id, b.incoming.id])).toEqual([
      [2000, "a", "b"],
      [3000, "b", "c"],
    ]);
    expect(clipBoundaries([clips[1] as Clip])).toEqual([]);
    expect(clipBoundaries(null)).toEqual([]);
  });
});

describe("transitionInputFrom", () => {
  it("is undefined for none or fewer than two clips", () => {
    expect(transitionInputFrom(DEFAULT_EFFECTS_SETTINGS, clips)).toBeUndefined();
    const on = { transition: { kind: "cut-with-zoom" as const, durationMs: 300 } };
    expect(transitionInputFrom(on, [clips[0] as Clip])).toBeUndefined();
    expect(transitionInputFrom(undefined, clips)).toBeUndefined();
    expect(transitionInputFrom(on, clips)).toEqual({
      kind: "cut-with-zoom",
      durationMs: 300,
      clips,
    });
  });
});

describe("transitionAt", () => {
  it("cross-dissolve fades the incoming first frame in before the boundary", () => {
    const input = { kind: "cross-dissolve" as const, durationMs: 400, clips };
    expect(transitionAt(input, 1599)).toBeNull();
    const start = transitionAt(input, 1600);
    expect(start).toMatchObject({ kind: "cross-dissolve", progress: 0, mix: 0, zoom: 1 });
    const mid = transitionAt(input, 1800);
    expect(mid?.mix).toBeCloseTo(0.5, 10);
    expect(mid).toMatchObject({ incomingClipId: "b", incomingSourceMs: 5000, boundaryMs: 2000 });
    expect(transitionAt(input, 1999)?.mix).toBeGreaterThan(0.99);
    // At the boundary the live video is on the incoming frame: no overlay.
    expect(transitionAt(input, 2000)).toBeNull();
  });

  it("cross-dissolve never exceeds the outgoing clip's length", () => {
    const input = { kind: "cross-dissolve" as const, durationMs: 2000, clips };
    // Clip b is 1000ms long, so the b→c dissolve starts at 2000.
    expect(transitionAt(input, 2000)?.incomingClipId).toBe("c");
    expect(transitionAt(input, 2500)?.mix).toBeCloseTo(0.5, 10);
  });

  it("cut-with-zoom peaks at 1.15× on the boundary and is symmetric", () => {
    const input = { kind: "cut-with-zoom" as const, durationMs: 400, clips };
    expect(transitionAt(input, 1799)).toBeNull();
    expect(transitionAt(input, 1800)?.zoom).toBeCloseTo(1, 10);
    expect(transitionAt(input, 2000)?.zoom).toBeCloseTo(CUT_ZOOM_PEAK, 10);
    expect(transitionAt(input, 1900)?.zoom).toBeCloseTo(transitionAt(input, 2100)?.zoom ?? 0, 10);
    expect(transitionAt(input, 2201)).toBeNull();
    for (let t = 1800; t <= 2200; t += 7) {
      const z = transitionAt(input, t)?.zoom ?? 1;
      expect(z).toBeGreaterThanOrEqual(1);
      expect(z).toBeLessThanOrEqual(CUT_ZOOM_PEAK + 1e-12);
    }
  });

  it("handles junk input", () => {
    const input = { kind: "cut-with-zoom" as const, durationMs: Number.NaN, clips };
    expect(transitionAt(input, 2000)).toBeNull();
    expect(transitionAt({ ...input, durationMs: 400 }, Number.NaN)).toBeNull();
    expect(transitionAt({ kind: "none", durationMs: 400, clips }, 2000)).toBeNull();
  });
});
