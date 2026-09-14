import { describe, expect, it } from "vitest";
import { DEFAULT_BASE, DEFAULT_PROPS } from "../inspector/annotations/types";
import type { Annotation } from "../inspector/annotations/types";
import type { Caption } from "../inspector/captions/types";
import type { ZoomRegion } from "../inspector/zoom/types";
import {
  annotationsToItems,
  captionsToItems,
  clipsToItems,
  formatMultiplier,
  makeTrack,
  speedToItems,
  truncateLabel,
  zoomToItems,
} from "./types";

const zoom = (over: Partial<ZoomRegion>): ZoomRegion => ({
  id: "z",
  startMs: 2000,
  endMs: 4500,
  level: 1.8,
  focus: { mode: "follow", x: 0.5, y: 0.5 },
  easeInMs: 300,
  easeOutMs: 300,
  curve: "ease-out-cubic",
  source: "manual",
  ...over,
});

describe("adapters", () => {
  it("formats multipliers", () => {
    expect(formatMultiplier(1.8)).toBe("1.8×");
    expect(formatMultiplier(2)).toBe("2×");
    expect(formatMultiplier(0.5)).toBe("0.5×");
    expect(formatMultiplier(1.25)).toBe("1.25×");
    expect(formatMultiplier(Number.NaN)).toBe("1×");
  });

  it("zoom items carry level labels and ghost only for auto suggestions", () => {
    const items = zoomToItems([zoom({}), zoom({ id: "a", source: "auto", level: 2 })]);
    expect(items[0]).toMatchObject({
      id: "z",
      startMs: 2000,
      endMs: 4500,
      label: "1.8×",
      ghost: false,
    });
    expect(items[1]).toMatchObject({ label: "2×", ghost: true });
  });

  it("speed items show the rate", () => {
    const items = speedToItems([
      { id: "s1", startMs: 0, endMs: 1000, rate: 2 },
      { id: "s2", startMs: 1000, endMs: 2000, rate: 0.5 },
    ]);
    expect(items.map((i) => i.label)).toEqual(["2×", "0.5×"]);
  });

  it("annotation items use the kind name", () => {
    const a: Annotation = {
      ...DEFAULT_BASE,
      ...DEFAULT_PROPS.arrow,
      id: "an",
      startMs: 1,
      endMs: 2,
    };
    expect(annotationsToItems([a])[0]).toMatchObject({ id: "an", label: "Arrow" });
  });

  it("caption items flatten line breaks and truncate", () => {
    const c: Caption = {
      id: "c",
      startMs: 0,
      endMs: 900,
      text: "Hello\nworld this is a very long caption that keeps going",
      words: [],
    } as unknown as Caption; // words shape is irrelevant to the adapter
    const label = captionsToItems([c])[0]?.label ?? "";
    expect(label.startsWith("Hello world")).toBe(true);
    expect(label.endsWith("…")).toBe(true);
    expect(label.length).toBeLessThanOrEqual(32);
    expect(truncateLabel("short")).toBe("short");
  });

  it("clip items map source ranges to timeline positions", () => {
    const items = clipsToItems([
      { id: "c1", sourceStartMs: 1000, sourceEndMs: 3000, timelineStartMs: 0 },
      { id: "c2", sourceStartMs: 5000, sourceEndMs: 6000, timelineStartMs: 2000 },
    ]);
    expect(items).toEqual([
      { id: "c1", startMs: 0, endMs: 2000, label: "Clip 1" },
      { id: "c2", startMs: 2000, endMs: 3000, label: "Clip 2" },
    ]);
  });

  it("makeTrack applies per-kind overlap rules", () => {
    expect(makeTrack("zoom", []).allowOverlap).toBe(false);
    expect(makeTrack("speed", []).allowOverlap).toBe(false);
    expect(makeTrack("annotations", []).allowOverlap).toBe(true);
    expect(makeTrack("captions", []).label).toBe("Captions");
  });
});
