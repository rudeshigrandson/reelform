import { describe, expect, it } from "vitest";
import { MIN_ZOOM_REGION_MS, type ZoomRegion } from "./types";
import {
  curvePath,
  deleteRegion,
  duplicateRegion,
  easeValue,
  focusToAnchor,
  formatTimecode,
  parseTimecode,
  regionDurationMs,
  sampleCurve,
  setCurve,
  setEaseMs,
  setEndMs,
  setFocusAnchor,
  setFocusMode,
  setFocusPoint,
  setLevel,
  setStartMs,
} from "./zoomLogic";

const region = (over: Partial<ZoomRegion> = {}): ZoomRegion => ({
  id: "z1",
  startMs: 1000,
  endMs: 3000,
  level: 2,
  focus: { mode: "fixed", x: 0.5, y: 0.5 },
  easeInMs: 600,
  easeOutMs: 700,
  curve: "ease-out-cubic",
  source: "auto",
  reason: "3 clicks",
  ...over,
});

describe("setLevel", () => {
  it("clamps to 1.0–4.0 and rounds", () => {
    expect(setLevel(region(), 9).level).toBe(4);
    expect(setLevel(region(), 0.2).level).toBe(1);
    expect(setLevel(region(), 2.345678).level).toBe(2.35);
  });
  it("marks edits manual and ignores non-finite input", () => {
    expect(setLevel(region(), 3).source).toBe("manual");
    const r = region();
    expect(setLevel(r, Number.NaN)).toBe(r);
  });
});

describe("setStartMs / setEndMs", () => {
  it("keeps start >= 0 and before end by the minimum length", () => {
    expect(setStartMs(region(), -500).startMs).toBe(0);
    expect(setStartMs(region(), 5000).startMs).toBe(3000 - MIN_ZOOM_REGION_MS);
    expect(setStartMs(region(), 1500.4).startMs).toBe(1500);
  });
  it("keeps end after start and within the timeline", () => {
    expect(setEndMs(region(), 500, 10_000).endMs).toBe(1000 + MIN_ZOOM_REGION_MS);
    expect(setEndMs(region(), 99_999, 10_000).endMs).toBe(10_000);
    expect(setEndMs(region(), 4000, 10_000).endMs).toBe(4000);
  });
  it("prefers minimum length when the region starts at the timeline end", () => {
    const r = region({ startMs: 9990, endMs: 10_000 });
    expect(setEndMs(r, 10_000, 10_000).endMs).toBe(9990 + MIN_ZOOM_REGION_MS);
  });
  it("ignores non-finite times", () => {
    const r = region();
    expect(setStartMs(r, Number.POSITIVE_INFINITY)).toBe(r);
    expect(setEndMs(r, Number.NaN, 10_000)).toBe(r);
  });
  it("derives duration", () => {
    expect(regionDurationMs(region())).toBe(2000);
    expect(regionDurationMs(region({ startMs: 5, endMs: 1 }))).toBe(0);
  });
});

describe("easing + focus edits", () => {
  it("clamps ease durations", () => {
    expect(setEaseMs(region(), "easeInMs", -10).easeInMs).toBe(0);
    expect(setEaseMs(region(), "easeOutMs", 99_999).easeOutMs).toBe(3000);
  });
  it("sets curve", () => {
    expect(setCurve(region(), "spring").curve).toBe("spring");
  });
  it("clamps focus point and preserves mode", () => {
    const r = setFocusPoint(region({ focus: { mode: "follow", x: 0, y: 0 } }), 1.4, -2);
    expect(r.focus).toEqual({ mode: "follow", x: 1, y: 0 });
  });
  it("anchor pins focus to fixed mode and maps back", () => {
    const r = setFocusAnchor(region({ focus: { mode: "follow", x: 0.2, y: 0.3 } }), "bottom-right");
    expect(r.focus).toEqual({ mode: "fixed", x: 1, y: 1 });
    expect(focusToAnchor(r.focus)).toBe("bottom-right");
    expect(focusToAnchor({ mode: "fixed", x: 0.31, y: 0.5 })).toBeNull();
  });
  it("switches focus mode", () => {
    expect(setFocusMode(region(), "follow").focus.mode).toBe("follow");
  });
});

describe("duplicateRegion / deleteRegion", () => {
  it("places the copy right after the original", () => {
    const out = duplicateRegion([region()], "z1", 10_000, "z2");
    expect(out).not.toBeNull();
    const copy = out?.find((r) => r.id === "z2");
    expect(copy).toMatchObject({ startMs: 3000, endMs: 5000, source: "manual", level: 2 });
    expect(copy?.reason).toBeUndefined();
    expect(out?.find((r) => r.id === "z1")?.source).toBe("auto");
  });
  it("skips past neighbours that would overlap", () => {
    const regions = [
      region(),
      region({ id: "a", startMs: 4000, endMs: 5000 }),
      region({ id: "b", startMs: 5500, endMs: 7000 }),
    ];
    const out = duplicateRegion(regions, "z1", 20_000, "z2") ?? [];
    const copy = out.find((r) => r.id === "z2");
    expect(copy).toMatchObject({ startMs: 7000, endMs: 9000 });
    expect(out.map((r) => r.id)).toEqual(["z1", "a", "b", "z2"]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.startMs).toBeGreaterThanOrEqual(out[i - 1]!.endMs);
    }
  });
  it("uses a gap that fits exactly", () => {
    const regions = [region(), region({ id: "a", startMs: 5000, endMs: 6000 })];
    const copy = duplicateRegion(regions, "z1", 20_000, "z2")?.find((r) => r.id === "z2");
    expect(copy).toMatchObject({ startMs: 3000, endMs: 5000 });
  });
  it("returns null when there is no room or the id is unknown", () => {
    expect(duplicateRegion([region()], "z1", 4000, "z2")).toBeNull();
    expect(duplicateRegion([region()], "nope", 10_000, "z2")).toBeNull();
  });
  it("deletes by id", () => {
    const regions = [region(), region({ id: "a", startMs: 4000, endMs: 5000 })];
    expect(deleteRegion(regions, "z1").map((r) => r.id)).toEqual(["a"]);
    expect(deleteRegion(regions, "missing")).toHaveLength(2);
  });
});

describe("curves", () => {
  it("all curves start at 0 and end at 1", () => {
    for (const c of ["ease-out-cubic", "spring", "linear"] as const) {
      expect(easeValue(c, 0)).toBeCloseTo(0);
      expect(easeValue(c, 1)).toBe(1);
      expect(easeValue(c, 5)).toBe(1);
      expect(easeValue(c, -1)).toBeCloseTo(0);
    }
  });
  it("ease-out leads linear; spring overshoots", () => {
    expect(easeValue("ease-out-cubic", 0.5)).toBeGreaterThan(easeValue("linear", 0.5));
    const peak = Math.max(...sampleCurve("spring", 64).map((s) => s.v));
    expect(peak).toBeGreaterThan(1);
  });
  it("samples inclusive endpoints with a minimum of 2", () => {
    const s = sampleCurve("linear", 5);
    expect(s.map((p) => p.t)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(sampleCurve("linear", 0)).toHaveLength(2);
  });
  it("builds a path that stays inside the box", () => {
    const d = curvePath(sampleCurve("spring", 16), 64, 32);
    expect(d.startsWith("M")).toBe(true);
    const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    for (const n of nums) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(64);
    }
    expect(curvePath(sampleCurve("linear", 2), 64, 32)).toBe("M2 30 L62 2");
  });
});

describe("timecode", () => {
  it("formats", () => {
    expect(formatTimecode(4200)).toBe("00:04.20");
    expect(formatTimecode(62_345)).toBe("01:02.35");
    expect(formatTimecode(3_723_000)).toBe("1:02:03.00");
    expect(formatTimecode(-5)).toBe("00:00.00");
    expect(formatTimecode(Number.NaN)).toBe("00:00.00");
  });
  it("parses and round-trips", () => {
    expect(parseTimecode("4.2")).toBe(4200);
    expect(parseTimecode("1:02.5")).toBe(62_500);
    expect(parseTimecode(" 1:02:03 ")).toBe(3_723_000);
    expect(parseTimecode(formatTimecode(62_340))).toBe(62_340);
  });
  it("rejects junk", () => {
    for (const bad of ["", "abc", "-1", "1::2", "1:2:3:4", "1.2.3"]) {
      expect(parseTimecode(bad)).toBeNull();
    }
  });
});
