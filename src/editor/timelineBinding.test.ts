import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SpeedRegionEdit } from "./inspector/effects/types";
import type { ZoomRegion } from "./inspector/zoom/types";
import type { Clip } from "./model/schema";
import { initialEditorData } from "./store";
import {
  ADD_REGION_MS,
  type TimelineDoc,
  addAtPlayhead,
  applyItemChange,
  buildTracks,
  clipsDurationMs,
  deleteSelection,
  itemChangeLabel,
  layoutClips,
  removeTimelineRange,
  rippleDeleteClips,
  scaleToZoom,
  selectionPatch,
  splitClipAt,
  trimClipToPlayhead,
  zoomToScale,
} from "./timelineBinding";

let seq = 0;
const makeId = (prefix: string): string => `${prefix}-${++seq}`;

function zoom(
  id: string,
  startMs: number,
  endMs: number,
  patch: Partial<ZoomRegion> = {},
): ZoomRegion {
  return {
    id,
    startMs,
    endMs,
    level: 1.8,
    focus: { mode: "fixed", x: 0.5, y: 0.5 },
    easeInMs: 600,
    easeOutMs: 700,
    curve: "ease-out-cubic",
    source: "manual",
    ...patch,
  };
}

function speed(id: string, startMs: number, endMs: number, rate = 2): SpeedRegionEdit {
  return { id, startMs, endMs, rate, keepPitch: true, rampInMs: 300, rampOutMs: 300 };
}

function doc(patch: Partial<TimelineDoc> = {}): TimelineDoc {
  const base = initialEditorData();
  return {
    durationMs: 10_000,
    clips: [{ id: "k1", sourceStartMs: 0, sourceEndMs: 10_000, timelineStartMs: 0 }],
    audio: base.audio,
    zoomRegions: base.zoomRegions,
    speedRegions: base.speedRegions,
    annotations: base.annotations,
    captions: base.captions,
    ...patch,
  };
}

describe("buildTracks", () => {
  it("builds zoom, speed, annotation and caption tracks with labels and ghosts", () => {
    const tracks = buildTracks(
      doc({
        zoomRegions: [zoom("z1", 0, 2000, { source: "auto", reason: "3 clicks" })],
        speedRegions: [speed("s1", 3000, 5000, 0.5)],
        captions: [{ id: "c1", startMs: 0, endMs: 900, text: "Hello there", words: [] }],
      }),
    );
    expect(tracks.map((t) => t.kind)).toEqual([
      "video",
      "zoom",
      "speed",
      "annotations",
      "captions",
    ]);
    expect(tracks[0]?.items[0]).toMatchObject({ label: "Clip 1", startMs: 0, endMs: 10_000 });
    expect(tracks[1]?.items[0]).toMatchObject({ label: "1.8×", ghost: true });
    expect(tracks[1]?.allowOverlap).toBe(false);
    expect(tracks[2]?.items[0]?.label).toBe("0.5×");
    expect(tracks[4]?.items[0]?.label).toBe("Hello there");
    expect(tracks[3]?.allowOverlap).toBe(true);
  });
});

describe("applyItemChange", () => {
  it("moves a zoom and promotes an auto suggestion to manual", () => {
    const d = doc({ zoomRegions: [zoom("z1", 0, 2000, { source: "auto", reason: "dwell" })] });
    const patch = applyItemChange(d, "zoom", { id: "z1", startMs: 1000, endMs: 3000 });
    expect(patch?.zoomRegions?.[0]).toMatchObject({ startMs: 1000, endMs: 3000, source: "manual" });
  });

  it("re-normalises speed ramps when a region is shrunk below 2× its ramp", () => {
    const d = doc({ speedRegions: [speed("s1", 0, 4000)] });
    const patch = applyItemChange(d, "speed", { id: "s1", startMs: 0, endMs: 400 });
    const region = patch?.speedRegions?.[0];
    expect(region?.endMs).toBe(400);
    expect(region?.rampInMs).toBeLessThanOrEqual(200);
    expect(region?.rampOutMs).toBeLessThanOrEqual(200);
  });

  it("retimes captions without touching their text", () => {
    const d = doc({ captions: [{ id: "c1", startMs: 0, endMs: 900, text: "Hi", words: [] }] });
    const patch = applyItemChange(d, "captions", { id: "c1", startMs: 500, endMs: 1500 });
    expect(patch?.captions?.[0]).toMatchObject({ startMs: 500, endMs: 1500, text: "Hi" });
  });

  it("returns null for unknown ids and for the video track", () => {
    const d = doc({ zoomRegions: [zoom("z1", 0, 2000)] });
    expect(applyItemChange(d, "zoom", { id: "nope", startMs: 0, endMs: 1 })).toBeNull();
    expect(applyItemChange(d, "video", { id: "z1", startMs: 0, endMs: 1 })).toBeNull();
  });

  it("does not mutate the input document", () => {
    const d = doc({ zoomRegions: [zoom("z1", 0, 2000)] });
    const snapshot = structuredClone(d);
    applyItemChange(d, "zoom", { id: "z1", startMs: 100, endMs: 900 });
    expect(d).toEqual(snapshot);
  });
});

describe("selectionPatch", () => {
  it("maps the timeline selection to per-kind inspector ids", () => {
    const d = doc({ zoomRegions: [zoom("z1", 0, 1000)], speedRegions: [speed("s1", 2000, 3000)] });
    expect(selectionPatch(d, new Set(["s1"]))).toEqual({
      selectedZoomId: null,
      selectedSpeedId: "s1",
      selectedAnnotationId: null,
    });
    expect(selectionPatch(d, new Set())).toEqual({
      selectedZoomId: null,
      selectedSpeedId: null,
      selectedAnnotationId: null,
    });
  });
});

describe("addAtPlayhead", () => {
  it("adds a selected 2s manual zoom at the playhead", () => {
    const res = addAtPlayhead(doc(), "zoom", 3000, makeId);
    const added = res?.patch.zoomRegions?.[0];
    expect(added).toMatchObject({ startMs: 3000, endMs: 3000 + ADD_REGION_MS, source: "manual" });
    expect(res?.patch.selectedZoomId).toBe(res?.id);
  });

  it("pulls a zoom back from the end and uses short easing when it can't fit 2s", () => {
    const res = addAtPlayhead(doc({ durationMs: 1000 }), "zoom", 990, makeId);
    const added = res?.patch.zoomRegions?.[0];
    expect(added?.endMs).toBe(1000);
    expect(added?.easeInMs).toBe(400);
  });

  it("refuses to add a zoom or speed on top of an existing region", () => {
    const d = doc({
      zoomRegions: [zoom("z1", 2000, 4000)],
      speedRegions: [speed("s1", 2000, 4000)],
    });
    expect(addAtPlayhead(d, "zoom", 2500, makeId)).toBeNull();
    expect(addAtPlayhead(d, "speed", 1000, makeId)).toBeNull();
  });

  it("adds a caption and refuses one inside an existing caption", () => {
    const res = addAtPlayhead(doc(), "captions", 1000, makeId);
    expect(res?.patch.captions).toHaveLength(1);
    const d = doc({ captions: res?.patch.captions ?? [] });
    expect(addAtPlayhead(d, "captions", 1500, makeId)).toBeNull();
  });

  it("adds a text annotation at the playhead and selects it", () => {
    const res = addAtPlayhead(doc(), "annotations", 4000, makeId);
    expect(res?.patch.annotations?.[0]).toMatchObject({ kind: "text", startMs: 4000 });
    expect(res?.patch.selectedAnnotationId).toBe(res?.id);
  });

  it("returns null on a zero-length timeline", () => {
    expect(addAtPlayhead(doc({ durationMs: 0 }), "zoom", 0, makeId)).toBeNull();
    expect(addAtPlayhead(doc({ durationMs: 0 }), "speed", 0, makeId)).toBeNull();
  });

  it("property: added zooms stay inside the timeline and never overlap", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 200, max: 60_000 }),
        fc.array(fc.double({ min: -1000, max: 70_000, noNaN: true }), { maxLength: 25 }),
        (durationMs, playheads) => {
          let d = doc({ durationMs });
          for (const p of playheads) {
            const res = addAtPlayhead(d, "zoom", p, makeId);
            if (res) d = { ...d, ...res.patch };
          }
          const sorted = [...d.zoomRegions].sort((a, b) => a.startMs - b.startMs);
          sorted.forEach((r, i) => {
            expect(r.startMs).toBeGreaterThanOrEqual(0);
            expect(r.endMs).toBeLessThanOrEqual(durationMs);
            expect(r.endMs).toBeGreaterThan(r.startMs);
            const next = sorted[i + 1];
            if (next) expect(r.endMs).toBeLessThanOrEqual(next.startMs);
          });
        },
      ),
    );
  });
});

describe("zoomToScale / scaleToZoom", () => {
  it("0 fits the whole duration and 1 shows 5 seconds", () => {
    expect(zoomToScale(0, 60_000, 1200)).toBeCloseTo(1200 / 60_000);
    expect(zoomToScale(1, 60_000, 1200)).toBeCloseTo(1200 / 5000);
  });

  it("clamps out-of-range and non-finite slider values", () => {
    expect(zoomToScale(-3, 60_000, 1200)).toBeCloseTo(zoomToScale(0, 60_000, 1200));
    expect(zoomToScale(9, 60_000, 1200)).toBeCloseTo(zoomToScale(1, 60_000, 1200));
    expect(zoomToScale(Number.NaN, 60_000, 1200)).toBeCloseTo(zoomToScale(0, 60_000, 1200));
  });

  it("returns 0 zoom for timelines no longer than the 5s minimum span or empty viewports", () => {
    expect(scaleToZoom(1, 4000, 1000)).toBe(0);
    expect(scaleToZoom(0, 60_000, 1000)).toBe(0);
    expect(scaleToZoom(1, 60_000, 0)).toBe(0);
  });

  it("property: scaleToZoom inverts zoomToScale", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 5001, max: 3_600_000 }),
        fc.integer({ min: 50, max: 4000 }),
        (z, durationMs, viewportPx) => {
          const back = scaleToZoom(zoomToScale(z, durationMs, viewportPx), durationMs, viewportPx);
          expect(back).toBeCloseTo(z, 6);
        },
      ),
    );
  });
});

describe("deleteSelection", () => {
  it("removes selected items across tracks and clears inspector selection", () => {
    const d = doc({
      zoomRegions: [zoom("z1", 0, 1000), zoom("z2", 2000, 3000)],
      speedRegions: [speed("s1", 4000, 5000)],
    });
    const patch = deleteSelection(d, new Set(["z2", "s1"]));
    expect(patch?.zoomRegions?.map((r) => r.id)).toEqual(["z1"]);
    expect(patch?.speedRegions).toEqual([]);
    expect(patch?.selectedZoomId).toBeNull();
  });

  it("returns null when nothing is selected or nothing matches", () => {
    const d = doc({ zoomRegions: [zoom("z1", 0, 1000)] });
    expect(deleteSelection(d, new Set())).toBeNull();
    expect(deleteSelection(d, new Set(["ghost"]))).toBeNull();
  });
});

// ── Video clip operations ──────────────────────────────────────────────────

const clip = (
  id: string,
  sourceStartMs: number,
  sourceEndMs: number,
  timelineStartMs = 0,
): Clip => ({
  id,
  sourceStartMs,
  sourceEndMs,
  timelineStartMs,
});

/** Three clips: [0,2000) [2000,5000) [5000,10000) on the timeline. */
const threeClips = (): Clip[] =>
  layoutClips([clip("a", 0, 2000), clip("b", 10_000, 13_000), clip("c", 20_000, 25_000)]);

function assertSequence(clips: readonly Clip[], durationMs: number | undefined) {
  let at = 0;
  for (const c of clips) {
    expect(c.timelineStartMs).toBe(at);
    expect(c.sourceEndMs).toBeGreaterThan(c.sourceStartMs);
    at += c.sourceEndMs - c.sourceStartMs;
  }
  if (durationMs !== undefined) expect(durationMs).toBe(at);
  expect(new Set(clips.map((c) => c.id)).size).toBe(clips.length);
}

describe("layoutClips / clipsDurationMs", () => {
  it("restamps contiguous timeline starts and keeps unchanged clips by identity", () => {
    const a = clip("a", 0, 1000, 0);
    const out = layoutClips([a, clip("b", 5000, 5500, 999)]);
    expect(out[0]).toBe(a);
    expect(out[1]?.timelineStartMs).toBe(1000);
    expect(clipsDurationMs(out)).toBe(1500);
    expect(clipsDurationMs([])).toBe(0);
  });
});

describe("splitClipAt (S)", () => {
  it("splits the clip under the playhead without changing duration", () => {
    const patch = splitClipAt(doc(), 4000, makeId);
    expect(patch?.durationMs).toBeUndefined();
    const clips = patch?.clips ?? [];
    expect(clips).toHaveLength(2);
    expect(clips[0]).toEqual(clip("k1", 0, 4000, 0));
    expect(clips[1]).toMatchObject({
      sourceStartMs: 4000,
      sourceEndMs: 10_000,
      timelineStartMs: 4000,
    });
    expect(clips[1]?.id).toMatch(/^clip-/);
    assertSequence(clips, 10_000);
  });

  it("maps playhead → source through earlier trims", () => {
    const d = doc({ clips: threeClips() });
    const clips = splitClipAt(d, 3000)?.clips ?? [];
    expect(clips.map((c) => [c.id, c.sourceStartMs, c.sourceEndMs])).toEqual([
      ["a", 0, 2000],
      ["b", 10_000, 11_000],
      ["b-2", 11_000, 13_000],
      ["c", 20_000, 25_000],
    ]);
  });

  it("refuses on clip boundaries, timeline ends and slivers under MIN_ITEM_MS", () => {
    const d = doc({ clips: threeClips() });
    for (const t of [0, 2000, 5000, 10_000, 2050, 4950, -5, 12_000, Number.NaN]) {
      expect(splitClipAt(d, t)).toBeNull();
    }
  });

  it("id factory collisions fall back to a unique derived id", () => {
    const d = doc({ clips: [clip("k1", 0, 10_000), clip("k1-2", 10_000, 12_000, 10_000)] });
    const clips = splitClipAt(d, 5000, () => "k1")?.clips ?? [];
    expect(clips.map((c) => c.id)).toEqual(["k1", "k1-3", "k1-2"]);
  });
});

describe("trimClipToPlayhead ([ and ])", () => {
  const regions = () =>
    doc({
      zoomRegions: [
        zoom("z-in", 1000, 2000),
        zoom("z-cross", 2500, 3500),
        zoom("z-after", 4000, 6000),
      ],
      speedRegions: [speed("s", 2900, 4000)],
      annotations: [{ ...(initialEditorData().annotations[0] ?? {}), id: "never" } as never].filter(
        () => false,
      ),
      captions: [
        {
          id: "c1",
          startMs: 3500,
          endMs: 5000,
          text: "hi there",
          words: [
            { t0: 3500, t1: 4000, text: "hi" },
            { t0: 4000, t1: 5000, text: "there" },
          ],
        },
      ],
    });

  it("[ removes clip start → playhead and ripples everything left", () => {
    const d = regions();
    const patch = trimClipToPlayhead(d, 3000, "start");
    expect(patch?.durationMs).toBe(7000);
    expect(patch?.clips).toEqual([clip("k1", 3000, 10_000, 0)]);
    expect(patch?.zoomRegions?.map((z) => [z.id, z.startMs, z.endMs])).toEqual([
      ["z-cross", 0, 500],
      ["z-after", 1000, 3000],
    ]);
    // Speed region lost its first 100ms: still ≥ min length, re-normalized.
    expect(patch?.speedRegions?.[0]).toMatchObject({ startMs: 0, endMs: 1000 });
    expect(patch?.captions?.[0]).toMatchObject({ startMs: 500, endMs: 2000 });
    expect(patch?.captions?.[0]?.words).toEqual([
      { t0: 500, t1: 1000, text: "hi" },
      { t0: 1000, t1: 2000, text: "there" },
    ]);
  });

  it("] removes playhead → clip end; later regions clamp to the new end", () => {
    const d = regions();
    const patch = trimClipToPlayhead(d, 5000, "end");
    expect(patch?.durationMs).toBe(5000);
    expect(patch?.zoomRegions?.find((z) => z.id === "z-after")).toMatchObject({
      startMs: 4000,
      endMs: 5000,
    });
    expect(patch?.captions?.[0]?.words).toEqual([
      { t0: 3500, t1: 4000, text: "hi" },
      { t0: 4000, t1: 5000, text: "there" },
    ]);
  });

  it("only touches the clip under the playhead; refuses on edges or tiny remainders", () => {
    const d = doc({ clips: threeClips() });
    const patch = trimClipToPlayhead(d, 3000, "end");
    expect(patch?.clips?.map((c) => [c.id, c.sourceStartMs, c.sourceEndMs])).toEqual([
      ["a", 0, 2000],
      ["b", 10_000, 11_000],
      ["c", 20_000, 25_000],
    ]);
    assertSequence(patch?.clips ?? [], patch?.durationMs);
    expect(trimClipToPlayhead(d, 2000, "start")).toBeNull();
    expect(trimClipToPlayhead(d, 4950, "start")).toBeNull();
    expect(trimClipToPlayhead(d, 2050, "end")).toBeNull();
  });

  it("drops regions that collapse inside the removed range, keeps point annotations outside it", () => {
    const base = initialEditorData();
    const point = (id: string, t: number) =>
      ({ ...(base.annotations[0] as object), id, kind: "text", startMs: t, endMs: t }) as never;
    const d = doc({ annotations: [point("in", 1000), point("out", 8000)] });
    const patch = trimClipToPlayhead(d, 3000, "start");
    expect(patch?.annotations?.map((a) => [a.id, a.startMs])).toEqual([["out", 5000]]);
    expect(patch?.zoomRegions).toEqual([]);
  });
});

describe("removeTimelineRange", () => {
  it("cuts the middle of a clip into two uniquely named pieces", () => {
    const patch = removeTimelineRange(doc(), 4000, 6000);
    expect(patch?.clips).toEqual([clip("k1", 0, 4000, 0), clip("k1-2", 6000, 10_000, 4000)]);
    expect(patch?.durationMs).toBe(8000);
  });

  it("refuses empty/reversed-to-empty ranges and removing (almost) everything", () => {
    const d = doc();
    expect(removeTimelineRange(d, 3000, 3000)).toBeNull();
    expect(removeTimelineRange(d, 12_000, 15_000)).toBeNull();
    expect(removeTimelineRange(d, 0, 10_000)).toBeNull();
    expect(removeTimelineRange(d, 0, 9950)).toBeNull();
    expect(removeTimelineRange(d, 6000, 4000)?.durationMs).toBe(8000);
  });
});

describe("rippleDeleteClips", () => {
  it("removes whole clips and closes the gap, shifting later regions", () => {
    const d = doc({ clips: threeClips(), zoomRegions: [zoom("z", 6000, 8000)] });
    const patch = rippleDeleteClips(d, new Set(["b"]));
    expect(patch?.clips?.map((c) => [c.id, c.timelineStartMs])).toEqual([
      ["a", 0],
      ["c", 2000],
    ]);
    expect(patch?.durationMs).toBe(7000);
    expect(patch?.zoomRegions?.[0]).toMatchObject({ startMs: 3000, endMs: 5000 });
  });

  it("deletes several clips at once, but never every clip", () => {
    const d = doc({ clips: threeClips() });
    expect(rippleDeleteClips(d, new Set(["a", "c"]))?.clips).toEqual([
      clip("b", 10_000, 13_000, 0),
    ]);
    expect(rippleDeleteClips(d, new Set(["a", "b", "c"]))).toBeNull();
    expect(rippleDeleteClips(d, new Set(["zzz"]))).toBeNull();
  });

  it("deleteSelection ripples selected clips together with selected regions", () => {
    const d = doc({
      clips: threeClips(),
      zoomRegions: [zoom("z1", 0, 1000), zoom("z2", 6000, 7000)],
    });
    const patch = deleteSelection(d, new Set(["b", "z1"]));
    expect(patch?.zoomRegions?.map((z) => [z.id, z.startMs])).toEqual([["z2", 3000]]);
    expect(patch?.durationMs).toBe(7000);
    expect(patch?.selectedZoomId).toBeNull();
    // Only the last clip selected → nothing to ripple, so region deletes alone apply.
    expect(deleteSelection(doc(), new Set(["k1"]))).toBeNull();
  });
});

describe("applyItemChange on the video track", () => {
  const d = () => doc({ clips: threeClips(), zoomRegions: [zoom("z", 6000, 7000)] });

  it("shrinking an end edge ripples; shrinking a start edge trims the source start", () => {
    const end = applyItemChange(d(), "video", { id: "b", startMs: 2000, endMs: 4000 });
    expect(end?.durationMs).toBe(9000);
    expect(end?.zoomRegions?.[0]?.startMs).toBe(5000);
    const start = applyItemChange(d(), "video", { id: "b", startMs: 2500, endMs: 5000 });
    expect(start?.clips?.[1]).toEqual(clip("b", 10_500, 13_000, 2000));
  });

  it("growing reveals source (bounded by 0 and the source length) and shifts later regions", () => {
    const grownEnd = applyItemChange(
      d(),
      "video",
      { id: "c", startMs: 5000, endMs: 12_000 },
      { sourceDurationMs: 26_000 },
    );
    expect(grownEnd?.clips?.[2]).toEqual(clip("c", 20_000, 26_000, 5000));
    expect(grownEnd?.durationMs).toBe(11_000);
    const grownStart = applyItemChange(d(), "video", { id: "b", startMs: 1000, endMs: 5000 });
    expect(grownStart?.clips?.[1]).toEqual(clip("b", 9000, 13_000, 2000));
    expect(grownStart?.zoomRegions?.[0]?.startMs).toBe(7000);
    expect(applyItemChange(d(), "video", { id: "a", startMs: -500, endMs: 2000 })).toBeNull();
    expect(applyItemChange(d(), "video", { id: "c", startMs: 5000, endMs: 12_000 })).toBeNull();
  });

  it("rejects body moves, unknown clips and sub-minimum clips", () => {
    expect(applyItemChange(d(), "video", { id: "b", startMs: 2500, endMs: 5500 })).toBeNull();
    expect(applyItemChange(d(), "video", { id: "nope", startMs: 0, endMs: 10 })).toBeNull();
    expect(applyItemChange(d(), "video", { id: "a", startMs: 0, endMs: 50 })).toBeNull();
  });

  it("labels drags for the undo tooltip", () => {
    const base = doc({ zoomRegions: [zoom("z", 0, 1000)] });
    expect(itemChangeLabel(base, "zoom", { id: "z", startMs: 500, endMs: 1500 })).toBe("Move zoom");
    expect(itemChangeLabel(base, "zoom", { id: "z", startMs: 0, endMs: 1500 })).toBe("Resize zoom");
    expect(itemChangeLabel(base, "video", { id: "k1", startMs: 0, endMs: 5 })).toBe("Trim clip");
  });
});

describe("property: clip ops keep the sequence valid", () => {
  type Op =
    | { kind: "split"; t: number }
    | { kind: "trim"; t: number; edge: "start" | "end" }
    | { kind: "ripple"; index: number }
    | { kind: "range"; a: number; b: number };
  const t = fc.integer({ min: -100, max: 30_000 });
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant("split" as const), t }),
    fc.record({
      kind: fc.constant("trim" as const),
      t,
      edge: fc.constantFrom("start" as const, "end" as const),
    }),
    fc.record({ kind: fc.constant("ripple" as const), index: fc.nat(5) }),
    fc.record({ kind: fc.constant("range" as const), a: t, b: t }),
  );

  it("contiguous clips, duration = Σ clips, regions inside [0, duration]", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), (ops) => {
        let d = doc({
          durationMs: 25_000,
          clips: [clip("k1", 0, 25_000)],
          zoomRegions: [
            zoom("z1", 1000, 3000),
            zoom("z2", 9000, 12_000),
            zoom("z3", 20_000, 24_000),
          ],
          speedRegions: [speed("s1", 4000, 8000)],
        });
        for (const op of ops) {
          const patch =
            op.kind === "split"
              ? splitClipAt(d, op.t, makeId)
              : op.kind === "trim"
                ? trimClipToPlayhead(d, op.t, op.edge)
                : op.kind === "ripple"
                  ? rippleDeleteClips(d, new Set([d.clips[op.index % d.clips.length]?.id ?? ""]))
                  : removeTimelineRange(d, op.a, op.b, makeId);
          if (patch) d = { ...d, ...patch };
          assertSequence(d.clips, d.durationMs);
          expect(d.durationMs).toBeGreaterThanOrEqual(100);
          for (const r of [...d.zoomRegions, ...d.speedRegions]) {
            expect(r.startMs).toBeGreaterThanOrEqual(0);
            expect(r.endMs).toBeLessThanOrEqual(d.durationMs);
            expect(r.endMs - r.startMs).toBeGreaterThanOrEqual(100);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
