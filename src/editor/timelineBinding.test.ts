import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SpeedRegionEdit } from "./inspector/effects/types";
import type { ZoomRegion } from "./inspector/zoom/types";
import { initialEditorData } from "./store";
import {
  ADD_REGION_MS,
  type TimelineDoc,
  addAtPlayhead,
  applyItemChange,
  buildTracks,
  deleteSelection,
  scaleToZoom,
  selectionPatch,
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
    expect(tracks.map((t) => t.kind)).toEqual(["zoom", "speed", "annotations", "captions"]);
    expect(tracks[0]?.items[0]).toMatchObject({ label: "1.8×", ghost: true });
    expect(tracks[0]?.allowOverlap).toBe(false);
    expect(tracks[1]?.items[0]?.label).toBe("0.5×");
    expect(tracks[3]?.items[0]?.label).toBe("Hello there");
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
