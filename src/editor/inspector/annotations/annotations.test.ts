import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ANNOTATION_KINDS,
  type Annotation,
  DEFAULT_DURATION_MS,
  DUPLICATE_OFFSET,
  MIN_DURATION_MS,
  createAnnotation,
  duplicateAnnotation,
  nextBadgeNumber,
  updateTiming,
} from "./index";

const make = (
  tool: (typeof ANNOTATION_KINDS)[number],
  playheadMs = 0,
  timelineDurationMs = 60_000,
  existing: Annotation[] = [],
) => createAnnotation(tool, { id: `id-${tool}`, playheadMs, timelineDurationMs, existing });

describe("createAnnotation", () => {
  it("creates every kind with defaults at the playhead for 3s", () => {
    for (const kind of ANNOTATION_KINDS) {
      const a = make(kind, 5000);
      expect(a.kind).toBe(kind);
      expect(a.startMs).toBe(5000);
      expect(a.endMs).toBe(5000 + DEFAULT_DURATION_MS);
      expect(a.id).toBe(`id-${kind}`);
    }
  });

  it("clamps to the timeline end, pulling start back near the end", () => {
    expect(make("text", 59_000)).toMatchObject({ startMs: 59_000, endMs: 60_000 });
    expect(make("text", 60_000)).toMatchObject({ startMs: 57_000, endMs: 60_000 });
    expect(make("text", 99_999)).toMatchObject({ startMs: 57_000, endMs: 60_000 });
    expect(make("text", -50)).toMatchObject({ startMs: 0, endMs: 3000 });
  });

  it("handles timelines shorter than the default duration", () => {
    expect(make("rect", 0, 1000)).toMatchObject({ startMs: 0, endMs: 1000 });
    expect(make("rect", 0, 0)).toMatchObject({ startMs: 0, endMs: MIN_DURATION_MS });
  });

  it("always yields a valid range inside the timeline (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000, max: 200_000 }),
        fc.integer({ min: 0, max: 120_000 }),
        (p, d) => {
          const a = make("arrow", p, d);
          const total = Math.max(MIN_DURATION_MS, d);
          return (
            a.startMs >= 0 &&
            a.endMs <= total &&
            a.endMs - a.startMs >= Math.min(MIN_DURATION_MS, total)
          );
        },
      ),
    );
  });

  it("auto-increments number badges from the max existing value", () => {
    const first = make("numberBadge");
    expect(first.kind === "numberBadge" && first.value).toBe(1);
    const existing = [
      { ...first, value: 4 },
      { ...first, id: "b", value: 2 },
      make("text"),
    ] as Annotation[];
    const next = make("numberBadge", 0, 60_000, existing);
    expect(next.kind === "numberBadge" && next.value).toBe(5);
  });

  it("centers on a click point, kept inside the frame", () => {
    const a = createAnnotation("rect", {
      id: "r",
      playheadMs: 0,
      timelineDurationMs: 10_000,
      at: { x: 0.5, y: 0.5 },
    });
    expect(a.x + a.w / 2).toBeCloseTo(0.5);
    const edge = createAnnotation("rect", {
      id: "r",
      playheadMs: 0,
      timelineDurationMs: 10_000,
      at: { x: 1, y: 0 },
    });
    expect(edge.x + edge.w).toBeLessThanOrEqual(1);
    expect(edge.y).toBe(0);
  });

  it("does not share nested animation objects between instances", () => {
    const a = make("text");
    const b = make("text");
    a.animIn.ms = 999;
    expect(b.animIn.ms).not.toBe(999);
  });
});

describe("nextBadgeNumber", () => {
  it("is 1 for empty and max+1 otherwise (property)", () => {
    expect(nextBadgeNumber([])).toBe(1);
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 1 }), (values) => {
        const badges = values.map((value, i) => ({
          ...make("numberBadge"),
          id: String(i),
          value,
        })) as Annotation[];
        return nextBadgeNumber(badges) === Math.max(0, ...values) + 1;
      }),
    );
  });
});

describe("duplicateAnnotation", () => {
  it("gets a new id and an offset, leaving the original untouched", () => {
    const a = make("ellipse");
    const d = duplicateAnnotation(a, "copy");
    expect(d.id).toBe("copy");
    expect(d.x).toBeCloseTo(a.x + DUPLICATE_OFFSET);
    expect(d.y).toBeCloseTo(a.y + DUPLICATE_OFFSET);
    expect(d.kind).toBe("ellipse");
    d.animOut.ms = 1;
    expect(a.animOut.ms).not.toBe(1);
  });

  it("keeps the copy inside the frame", () => {
    const a = { ...make("rect"), x: 0.8, y: 0.9, w: 0.2, h: 0.1 };
    const d = duplicateAnnotation(a, "copy");
    expect(d.x + d.w).toBeLessThanOrEqual(1);
    expect(d.y + d.h).toBeLessThanOrEqual(1);
  });

  it("gives duplicated number badges the next number", () => {
    const badge = make("numberBadge");
    const d = duplicateAnnotation(badge, "copy", [badge]);
    expect(d.kind === "numberBadge" && d.value).toBe(2);
  });
});

describe("updateTiming", () => {
  const a = { ...make("text"), startMs: 1000, endMs: 4000 };

  it("applies valid edits", () => {
    expect(updateTiming(a, { startMs: 2000 }, 10_000)).toMatchObject({
      startMs: 2000,
      endMs: 4000,
    });
    expect(updateTiming(a, { endMs: 8000 }, 10_000)).toMatchObject({ startMs: 1000, endMs: 8000 });
  });

  it("pushes end when start passes it, and pulls start when end precedes it", () => {
    expect(updateTiming(a, { startMs: 5000 }, 10_000)).toMatchObject({
      startMs: 5000,
      endMs: 5000 + MIN_DURATION_MS,
    });
    expect(updateTiming(a, { endMs: 500 }, 10_000)).toMatchObject({ startMs: 400, endMs: 500 });
  });

  it("clamps to the timeline", () => {
    expect(updateTiming(a, { endMs: 99_999 }, 10_000).endMs).toBe(10_000);
    expect(updateTiming(a, { startMs: 99_999 }, 10_000)).toMatchObject({
      startMs: 9900,
      endMs: 10_000,
    });
    expect(updateTiming(a, { startMs: -5 }, 10_000).startMs).toBe(0);
  });

  it("always keeps 0 <= start < end <= duration (property)", () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: -50_000, max: 50_000 }), { nil: undefined }),
        fc.option(fc.integer({ min: -50_000, max: 50_000 }), { nil: undefined }),
        fc.integer({ min: 0, max: 40_000 }),
        (startMs, endMs, duration) => {
          const r = updateTiming(a, { startMs, endMs }, duration);
          const total = Math.max(MIN_DURATION_MS, duration);
          return r.startMs >= 0 && r.endMs <= total && r.endMs - r.startMs >= MIN_DURATION_MS;
        },
      ),
    );
  });
});
