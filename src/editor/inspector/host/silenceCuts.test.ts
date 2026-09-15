import { describe, expect, it } from "vitest";
import type { Clip } from "../../model/schema";
import { initialEditorData } from "../../store";
import type { TimelineDoc } from "../../timelineBinding";
import type { ZoomRegion } from "../zoom/types";
import { applySilenceCuts } from "./EffectsTab";

const clip = (id: string, s: number, e: number, t: number): Clip => ({
  id,
  sourceStartMs: s,
  sourceEndMs: e,
  timelineStartMs: t,
});

const zoom = (id: string, startMs: number, endMs: number): ZoomRegion => ({
  id,
  startMs,
  endMs,
  level: 2,
  focus: { mode: "fixed", x: 0.5, y: 0.5 },
  easeInMs: 100,
  easeOutMs: 100,
  curve: "linear",
  source: "manual",
});

function doc(over: Partial<TimelineDoc>): TimelineDoc {
  const d = initialEditorData();
  const base: TimelineDoc = {
    durationMs: 10_000,
    clips: [clip("a", 0, 10_000, 0)],
    zoomRegions: [],
    speedRegions: [],
    annotations: [],
    captions: [],
    audio: d.audio,
  };
  return { ...base, ...over };
}

describe("applySilenceCuts", () => {
  it("returns null with no gaps or gaps only in trimmed source", () => {
    expect(applySilenceCuts(doc({}), [])).toBeNull();
    const trimmed = doc({ clips: [clip("a", 5000, 10_000, 0)], durationMs: 5000 });
    expect(applySilenceCuts(trimmed, [{ startMs: 1000, endMs: 4000 }])).toBeNull();
  });

  it("ripples several gaps in one patch and shifts items after each cut", () => {
    const d = doc({
      zoomRegions: [
        zoom("before", 500, 1500),
        zoom("inside", 2200, 2800),
        zoom("after", 7000, 8000),
      ],
      captions: [
        {
          id: "c",
          startMs: 6500,
          endMs: 7500,
          text: "hi",
          words: [{ t0: 6500, t1: 7000, text: "hi" }],
        },
      ],
    });
    const res = applySilenceCuts(d, [
      { startMs: 2000, endMs: 3000 },
      { startMs: 5000, endMs: 6000 },
    ]);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.removedMs).toBe(2000);
    expect(res.patch.durationMs).toBe(8000);
    expect(res.patch.clips.map((c) => [c.sourceStartMs, c.sourceEndMs, c.timelineStartMs])).toEqual(
      [
        [0, 2000, 0],
        [3000, 5000, 2000],
        [6000, 10_000, 4000],
      ],
    );
    expect(new Set(res.patch.clips.map((c) => c.id)).size).toBe(3);
    expect(res.patch.zoomRegions.map((z) => [z.id, z.startMs, z.endMs])).toEqual([
      ["before", 500, 1500],
      ["after", 5000, 6000],
    ]);
    expect(res.patch.captions[0]).toMatchObject({
      startMs: 4500,
      endMs: 5500,
      words: [{ t0: 4500, t1: 5000, text: "hi" }],
    });
  });

  it("maps gaps through a trimmed clip before cutting", () => {
    // Source 0–4s trimmed away: source gap 6–7s is timeline 2–3s.
    const d = doc({ clips: [clip("a", 4000, 10_000, 0)], durationMs: 6000 });
    const res = applySilenceCuts(d, [{ startMs: 6000, endMs: 7000 }]);
    expect(
      res?.patch.clips.map((c) => [c.sourceStartMs, c.sourceEndMs, c.timelineStartMs]),
    ).toEqual([
      [4000, 6000, 0],
      [7000, 10_000, 2000],
    ]);
    expect(res?.patch.durationMs).toBe(5000);
  });

  it("never removes the whole video", () => {
    const res = applySilenceCuts(doc({}), [{ startMs: 0, endMs: 10_000 }]);
    expect(res).toBeNull();
  });
});
