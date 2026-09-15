import { describe, expect, it } from "vitest";
import type { SuggestedZoom, Telemetry } from "../../autozoom";
import { DEFAULT_ZOOM_SETTINGS, type ZoomRegion } from "../zoom";
import { setLevel } from "../zoom/zoomLogic";
import {
  generateSuggestions,
  mergeZoomSuggestions,
  reviewDone,
  reviewStep,
  startReview,
  suggestionsToTimeline,
  suggestionsToastText,
} from "./zoomSuggestions";

const sug = (id: string, startMs: number, endMs: number): SuggestedZoom => ({
  id,
  startMs,
  endMs,
  level: 2,
  focus: { mode: "fixed", x: 0.5, y: 0.5 },
  easeInMs: 600,
  easeOutMs: 700,
  curve: "ease-out-cubic",
  source: "auto",
  reason: "1 click",
});

const auto = (id: string, s: number, e: number): ZoomRegion => ({ ...sug(id, s, e) });

/** Clicks at 2s / 10s / 20s with the cursor parked at each click. */
function clickTelemetry(): Telemetry {
  const points: [number, number, number, string][] = [];
  const at = (t: number) => (t < 8000 ? [0.2, 0.3] : t < 18_000 ? [0.7, 0.6] : [0.4, 0.8]);
  for (let t = 0; t <= 26_000; t += 50) {
    const [x, y] = at(t) as [number, number];
    points.push([t, x, y, "arrow"]);
  }
  const clicks = [2000, 10_000, 20_000].flatMap((t) => {
    const [x, y] = at(t) as [number, number];
    return [[t, x, y, "left", "down"] as const, [t + 80, x, y, "left", "up"] as const];
  });
  return { points, clicks, keys: [], scrolls: [] };
}

describe("generateSuggestions", () => {
  const base = {
    telemetry: clickTelemetry(),
    sourceSize: { width: 1920, height: 1080 },
    clips: [{ sourceStartMs: 0, sourceEndMs: 26_000, timelineStartMs: 0 }] as never,
    settings: DEFAULT_ZOOM_SETTINGS.autoZoom,
  };

  it("suggests zooms from clicks and is deterministic", () => {
    const a = generateSuggestions(base);
    expect(a.length).toBeGreaterThan(0);
    expect(generateSuggestions(base)).toEqual(a);
    for (const z of a) expect(z.source).toBe("auto");
  });

  it("respects zoomOnClicks=false (no candidates without clicks)", () => {
    const none = generateSuggestions({
      ...base,
      settings: { ...base.settings, zoomOnClicks: false, zoomOnTyping: false },
    });
    expect(none.length).toBeLessThan(generateSuggestions(base).length);
  });

  it("handles a missing source size", () => {
    expect(() => generateSuggestions({ ...base, sourceSize: null })).not.toThrow();
  });
});

describe("mergeZoomSuggestions (regenerate)", () => {
  it("replaces untouched auto regions but preserves edited and manual ones", () => {
    const edited = setLevel(auto("az_1", 5000, 7000), 3);
    expect(edited.source).toBe("manual");
    const manual: ZoomRegion = { ...auto("m1", 12_000, 14_000), source: "manual" };
    const existing = [auto("az_0", 0, 2000), edited, manual, auto("az_2", 20_000, 22_000)];
    const merged = mergeZoomSuggestions(existing, [
      sug("az_0", 500, 2500),
      sug("az_1", 5500, 6500), // collides with the edited region → dropped
      sug("az_3", 16_000, 18_000),
    ]);
    expect(merged.map((r) => [r.id, r.startMs, r.source])).toEqual([
      ["az_0", 500, "auto"],
      ["az_1", 5000, "manual"],
      ["m1", 12_000, "manual"],
      ["az_3", 16_000, "auto"],
    ]);
    expect(merged.find((r) => r.id === "az_1")?.level).toBe(3);
  });

  it("uniquifies ids that clash with kept regions", () => {
    const kept: ZoomRegion = { ...auto("az_0", 9000, 9500), source: "manual" };
    const merged = mergeZoomSuggestions([kept], [sug("az_0", 0, 1000)]);
    expect(merged.map((r) => r.id)).toEqual(["az_0-2", "az_0"]);
  });

  it("keeping nothing removes only untouched auto regions", () => {
    const manual: ZoomRegion = { ...auto("m", 0, 1000), source: "manual" };
    expect(mergeZoomSuggestions([auto("a", 2000, 3000), manual], [])).toEqual([manual]);
  });
});

describe("review stepper", () => {
  it("steps keep/skip and finishes with the kept subset", () => {
    let s = startReview([sug("a", 0, 1), sug("b", 2, 3), sug("c", 4, 5)]);
    s = reviewStep(s, "keep");
    s = reviewStep(s, "skip");
    expect(reviewDone(s)).toBe(false);
    s = reviewStep(s, "keep");
    expect(reviewDone(s)).toBe(true);
    expect(s.kept.map((k) => k.id)).toEqual(["a", "c"]);
    expect(reviewStep(s, "keep")).toBe(s);
  });

  it("toast copy", () => {
    expect(suggestionsToastText(0)).toBe("No zoom suggestions found");
    expect(suggestionsToastText(1)).toBe("We suggested 1 zoom");
    expect(suggestionsToastText(4)).toBe("We suggested 4 zooms");
  });
});

describe("suggestionsToTimeline", () => {
  const c = (sourceStartMs: number, sourceEndMs: number, timelineStartMs: number) => ({
    id: `c${timelineStartMs}`,
    sourceStartMs,
    sourceEndMs,
    timelineStartMs,
  });

  it("passes through without clips", () => {
    const s = [sug("a", 100, 900)];
    expect(suggestionsToTimeline(s, [])).toEqual(s);
  });

  it("maps source ms onto the timeline, cuts at clip ends, drops trimmed starts", () => {
    // Source 0–4s trimmed off; kept 4–10s at timeline 0, then 12–20s at 6s.
    const clips = [c(4000, 10_000, 0), c(12_000, 20_000, 6000)];
    const out = suggestionsToTimeline(
      [
        sug("trimmed", 1000, 3000),
        sug("first", 5000, 7000),
        sug("tail", 9000, 11_000), // runs past the clip end → cut at 10s source
        sug("second", 13_000, 15_000),
      ],
      clips,
    );
    expect(out.map((z) => [z.id, z.startMs, z.endMs])).toEqual([
      ["first", 1000, 3000],
      ["tail", 5000, 6000],
      ["second", 7000, 9000],
    ]);
  });

  it("keeps regions non-overlapping when clips are reordered", () => {
    const clips = [c(10_000, 20_000, 0), c(0, 10_000, 10_000)];
    const out = suggestionsToTimeline([sug("a", 1000, 5000), sug("b", 12_000, 13_000)], clips);
    expect(out.map((z) => [z.id, z.startMs, z.endMs])).toEqual([
      ["b", 2000, 3000],
      ["a", 11_000, 15_000],
    ]);
    for (let i = 1; i < out.length; i++) {
      expect((out[i] as SuggestedZoom).startMs).toBeGreaterThanOrEqual(
        (out[i - 1] as SuggestedZoom).endMs,
      );
    }
  });
});
