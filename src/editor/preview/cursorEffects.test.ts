import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TelemetryClick } from "../autozoom/types";
import {
  BOUNCE_MIN_SCALE,
  BOUNCE_MS,
  HIDE_FADE_IN_MS,
  HIDE_FADE_OUT_MS,
  HIGHLIGHT_FADE_IN_MS,
  HIGHLIGHT_FADE_OUT_MS,
  LOOP_MS,
  MAX_GHOSTS,
  RIPPLE_MS,
  SWAY_IDLE_MS,
  SWAY_MAX_PX,
  bounceScale,
  buildCursorMotion,
  clickEffectsAt,
  hideIdleAlpha,
  idleAt,
  idleIntervals,
  loopBlend,
  motionBlurGhosts,
  pairClicks,
  swayOffset,
  valueNoise,
} from "./cursorEffects";

const clicks: TelemetryClick[] = [
  [1000, 0.5, 0.5, "left", "down"],
  [1200, 0.5, 0.5, "left", "up"],
  [3000, 0.2, 0.2, "right", "down"],
];

describe("pairClicks", () => {
  it("pairs downs with the next up of the same button", () => {
    const ev = pairClicks([...clicks].reverse());
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ tMs: 1000, upMs: 1200 });
    expect(ev[1]).toMatchObject({ tMs: 3000, upMs: null });
  });
});

describe("click effect timing", () => {
  const ev = pairClicks(clicks);

  it("ripple lives exactly 300ms from each down, fading and expanding", () => {
    expect(clickEffectsAt("ripple", ev, 999)).toEqual([]);
    const start = clickEffectsAt("ripple", ev, 1000);
    expect(start[0]).toMatchObject({ kind: "ripple", alpha: 1, progress: 0 });
    const mid = clickEffectsAt("ripple", ev, 1150)[0];
    expect(mid?.radius).toBeGreaterThan(start[0]?.radius ?? 1);
    expect(clickEffectsAt("ripple", ev, 1000 + RIPPLE_MS)[0]?.alpha).toBe(0);
    expect(clickEffectsAt("ripple", ev, 1000 + RIPPLE_MS + 1)).toEqual([]);
  });

  it("highlight holds through the press and fades after release", () => {
    expect(clickEffectsAt("highlight", ev, 1000 + HIGHLIGHT_FADE_IN_MS / 2)[0]?.alpha).toBeCloseTo(
      0.5,
    );
    expect(clickEffectsAt("highlight", ev, 1150)[0]?.alpha).toBe(1);
    expect(clickEffectsAt("highlight", ev, 1200 + HIGHLIGHT_FADE_OUT_MS / 2)[0]?.alpha).toBeCloseTo(
      0.5,
    );
    expect(clickEffectsAt("highlight", ev, 1200 + HIGHLIGHT_FADE_OUT_MS + 1)).toEqual([]);
    // Unreleased click: short hold then fade.
    expect(
      clickEffectsAt("highlight", ev, 3000 + HIGHLIGHT_FADE_IN_MS + HIGHLIGHT_FADE_OUT_MS + 1),
    ).toEqual([]);
  });

  it("none/bounce produce no rings", () => {
    expect(clickEffectsAt("none", ev, 1000)).toEqual([]);
    expect(clickEffectsAt("bounce", ev, 1000)).toEqual([]);
  });

  it("bounce dips to 0.85 at mid-press and returns to 1", () => {
    expect(bounceScale(ev, 999)).toBe(1);
    expect(bounceScale(ev, 1000 + BOUNCE_MS / 2)).toBeCloseTo(BOUNCE_MIN_SCALE);
    expect(bounceScale(ev, 1000 + BOUNCE_MS)).toBeCloseTo(1);
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 5000, noNaN: true }), (t) => {
        const s = bounceScale(ev, t);
        expect(s).toBeGreaterThanOrEqual(BOUNCE_MIN_SCALE - 1e-9);
        expect(s).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("idle", () => {
  const points = [
    { tMs: 0, x: 0.1, y: 0.1 },
    { tMs: 100, x: 0.2, y: 0.2 },
    { tMs: 1100, x: 0.2, y: 0.2 },
    { tMs: 2100, x: 0.2001, y: 0.2 },
    { tMs: 2200, x: 0.5, y: 0.5 },
    { tMs: 2300, x: 0.6, y: 0.6 },
  ];
  const idle = idleIntervals(points);

  it("indexes still stretches (sub-epsilon jitter counts as still) and the trailing one", () => {
    expect(idle).toEqual([
      { startMs: 100, endMs: 2100 },
      { startMs: 2300, endMs: Number.POSITIVE_INFINITY },
    ]);
    expect(idleAt(idle, 50)).toEqual({ idleForMs: 0, sinceIdleEndMs: null, endedIdleLengthMs: 0 });
    expect(idleAt(idle, 1100).idleForMs).toBe(1000);
    expect(idleAt(idle, 2150)).toMatchObject({ sinceIdleEndMs: 50, endedIdleLengthMs: 2000 });
  });

  it("hide-when-idle fades out after the delay and back in on move", () => {
    expect(hideIdleAlpha(idle, 1000, 500)).toBe(1 - Math.min(1, (900 - 500) / HIDE_FADE_OUT_MS));
    expect(hideIdleAlpha(idle, 2000, 500)).toBe(0);
    expect(hideIdleAlpha(idle, 2100 + HIDE_FADE_IN_MS / 2, 500)).toBeCloseTo(0.5);
    expect(hideIdleAlpha(idle, 2100 + HIDE_FADE_IN_MS, 500)).toBe(1);
    expect(hideIdleAlpha(idle, 1000, 5000)).toBe(1);
  });

  it("sway is zero before 600ms idle and bounded by 3px after", () => {
    expect(swayOffset(idle, 100 + SWAY_IDLE_MS)).toEqual({ x: 0, y: 0 });
    fc.assert(
      fc.property(fc.double({ min: 0, max: 20_000, noNaN: true }), (t) => {
        const s = swayOffset(idle, t);
        expect(Math.abs(s.x)).toBeLessThanOrEqual(SWAY_MAX_PX + 1e-9);
        expect(Math.abs(s.y)).toBeLessThanOrEqual(SWAY_MAX_PX + 1e-9);
        expect(swayOffset(idle, t)).toEqual(s);
      }),
    );
    expect(Math.abs(valueNoise(3.5, 1))).toBeLessThanOrEqual(1);
  });

  it("buildCursorMotion reports the cursor type at a time", () => {
    const m = buildCursorMotion({
      points: [
        { tMs: 0, x: 0, y: 0, cursorType: "arrow" },
        { tMs: 500, x: 0, y: 0, cursorType: "ibeam" },
      ],
      clicks,
    });
    expect(m.typeAt(-10)).toBe("arrow");
    expect(m.typeAt(499)).toBe("arrow");
    expect(m.typeAt(500)).toBe("ibeam");
    expect(m.clicks).toHaveLength(2);
    expect(buildCursorMotion({ points: [] }).typeAt(0)).toBeUndefined();
  });
});

describe("motion blur + loop", () => {
  it("amount maps to 1..6 ghosts with decaying alpha", () => {
    expect(motionBlurGhosts(0)).toEqual([]);
    expect(motionBlurGhosts(100)).toHaveLength(MAX_GHOSTS);
    const g = motionBlurGhosts(50);
    for (let i = 1; i < g.length; i++) {
      expect(g[i]?.alpha ?? 0).toBeLessThan(g[i - 1]?.alpha ?? 0);
      expect(g[i]?.backMs ?? 0).toBeGreaterThan(g[i - 1]?.backMs ?? 0);
    }
  });

  it("loop blend is 0 until the last 500ms and 1 at the end", () => {
    expect(loopBlend(0, 10_000)).toBe(0);
    expect(loopBlend(10_000 - LOOP_MS, 10_000)).toBe(0);
    expect(loopBlend(10_000 - LOOP_MS / 2, 10_000)).toBeCloseTo(0.5);
    expect(loopBlend(10_000, 10_000)).toBe(1);
    expect(loopBlend(100, 0)).toBe(0);
  });
});
