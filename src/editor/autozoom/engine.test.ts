import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { suggestZooms, timelineEnd } from "./index.js";
import type { Clip } from "../model/schema.js";
import type {
  AutoZoomOptions,
  SuggestParams,
  Telemetry,
  TelemetryClick,
  TelemetryKey,
  TelemetryPoint,
  TelemetryScroll,
} from "./types.js";

const ALL_ON: AutoZoomOptions = {
  zoomOnClicks: true,
  zoomOnTyping: true,
  followCursor: true,
};

function params(over: Partial<SuggestParams> = {}): SuggestParams {
  return {
    telemetry: { points: [], clicks: [], keys: [], scrolls: [] },
    content: { w: 1920, h: 1080 },
    clips: [],
    sensitivity: 0.5,
    options: ALL_ON,
    ...over,
  };
}

/** Compile-time proof that the schema Clip satisfies ClipRange. */
const _clipCompat: SuggestParams["clips"][number] = {
  sourceStartMs: 0,
  sourceEndMs: 1,
  timelineStartMs: 0,
} satisfies Pick<Clip, "sourceStartMs" | "sourceEndMs" | "timelineStartMs">;
void _clipCompat;

describe("suggestZooms — fixtures", () => {
  it("three clicks near each other → one region reasoned '3 clicks'", () => {
    const clicks: TelemetryClick[] = [
      [1000, 0.5, 0.5, "left", "down"],
      [1000, 0.5, 0.5, "left", "up"],
      [1500, 0.5, 0.5, "left", "down"],
      [1500, 0.5, 0.5, "left", "up"],
      [2000, 0.51, 0.5, "left", "down"],
    ];
    const out = suggestZooms(params({ telemetry: tele({ clicks }) }));
    expect(out).toHaveLength(1);
    expect(out[0]?.reason).toContain("clicks");
    expect(out[0]?.source).toBe("auto");
    expect(out[0]?.curve).toBe("ease-out-cubic");
  });

  it("two far-apart click clusters → two regions", () => {
    const clicks: TelemetryClick[] = [
      [1000, 0.2, 0.2, "left", "down"],
      [8000, 0.8, 0.8, "left", "down"],
    ];
    const out = suggestZooms(params({ telemetry: tele({ clicks }) }));
    expect(out).toHaveLength(2);
    expect(out[0]?.reason).toContain("click");
  });

  it("a typing burst → one 'typing' region when zoomOnTyping is on", () => {
    const keys: TelemetryKey[] = [
      [4000, 65, 0],
      [4200, 66, 0],
      [4400, 67, 0],
      [4600, 68, 0],
    ];
    // click well outside the 800ms NMS window so the typing candidate survives;
    // it also seeds the focus position for the burst.
    const clicks: TelemetryClick[] = [[900, 0.4, 0.6, "left", "down"]];
    const out = suggestZooms(params({ telemetry: tele({ keys, clicks }) }));
    expect(out.length).toBeGreaterThanOrEqual(1);
    const joined = out.map((z) => z.reason).join("|");
    expect(joined).toContain("typing");
  });

  it("respects zoomOnClicks=false", () => {
    const clicks: TelemetryClick[] = [[1000, 0.5, 0.5, "left", "down"]];
    const out = suggestZooms(
      params({
        telemetry: tele({ clicks }),
        options: { ...ALL_ON, zoomOnClicks: false },
      }),
    );
    expect(out).toHaveLength(0);
  });

  it("drops candidates inside trimmed ranges", () => {
    const clicks: TelemetryClick[] = [[5000, 0.5, 0.5, "left", "down"]];
    // only [0,1000] is kept; the click at 5000 is trimmed away
    const clips = [{ sourceStartMs: 0, sourceEndMs: 1000, timelineStartMs: 0 }];
    const out = suggestZooms(params({ telemetry: tele({ clicks }), clips }));
    expect(out).toHaveLength(0);
  });
});

describe("suggestZooms — invariants", () => {
  it("regions never overlap and stay within [0, timelineEnd]", () => {
    const clicks: TelemetryClick[] = [];
    for (let i = 0; i < 20; i++) {
      clicks.push([i * 900, (i % 5) / 5, ((i * 7) % 5) / 5, "left", "down"]);
    }
    const p = params({ telemetry: tele({ clicks }) });
    const out = suggestZooms(p);
    const end = timelineEnd(p);
    let prevEnd = 0;
    for (const z of out) {
      expect(z.startMs).toBeGreaterThanOrEqual(0);
      expect(z.endMs).toBeLessThanOrEqual(end);
      expect(z.endMs).toBeGreaterThan(z.startMs);
      expect(z.startMs).toBeGreaterThanOrEqual(prevEnd);
      prevEnd = z.endMs;
    }
  });
});

describe("suggestZooms — property tests", () => {
  const arbClick = fc.tuple(
    fc.integer({ min: 0, max: 60_000 }),
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.constantFrom("left" as const, "right" as const, "middle" as const),
    fc.constantFrom("down" as const, "up" as const),
  );
  const arbPoint = fc.tuple(
    fc.integer({ min: 0, max: 60_000 }),
    fc.double({ min: -0.5, max: 1.5, noNaN: true }),
    fc.double({ min: -0.5, max: 1.5, noNaN: true }),
    fc.constant("arrow"),
  );

  it("levels ∈ [1.3,2.6] and focus x,y ∈ [0,1] for arbitrary inputs", () => {
    fc.assert(
      fc.property(
        fc.array(arbClick, { maxLength: 40 }),
        fc.array(arbPoint, { maxLength: 60 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.boolean(),
        (clicks, points, sensitivity, followCursor) => {
          const out = suggestZooms(
            params({
              telemetry: tele({
                clicks: clicks as TelemetryClick[],
                points: points as TelemetryPoint[],
              }),
              sensitivity,
              options: { zoomOnClicks: true, zoomOnTyping: true, followCursor },
            }),
          );
          for (const z of out) {
            expect(z.level).toBeGreaterThanOrEqual(1.3);
            expect(z.level).toBeLessThanOrEqual(2.6);
            expect(z.focus.x).toBeGreaterThanOrEqual(0);
            expect(z.focus.x).toBeLessThanOrEqual(1);
            expect(z.focus.y).toBeGreaterThanOrEqual(0);
            expect(z.focus.y).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("output is always non-overlapping for arbitrary inputs", () => {
    fc.assert(
      fc.property(fc.array(arbClick, { maxLength: 50 }), (clicks) => {
        const out = suggestZooms(
          params({ telemetry: tele({ clicks: clicks as TelemetryClick[] }) }),
        );
        let prevEnd = -1;
        for (const z of out) {
          expect(z.startMs).toBeGreaterThanOrEqual(prevEnd);
          expect(z.endMs).toBeGreaterThan(z.startMs);
          prevEnd = z.endMs;
        }
      }),
      { numRuns: 200 },
    );
  });

  it("is deterministic: same input → identical output", () => {
    const clicks: TelemetryClick[] = [
      [1000, 0.5, 0.5, "left", "down"],
      [5000, 0.2, 0.8, "left", "down"],
    ];
    const scrolls: TelemetryScroll[] = [[3000, 0, 5]];
    const p = params({ telemetry: tele({ clicks, scrolls }) });
    expect(JSON.stringify(suggestZooms(p))).toEqual(JSON.stringify(suggestZooms(p)));
  });
});

function tele(over: Partial<Telemetry> = {}): Telemetry {
  return { points: [], clicks: [], keys: [], scrolls: [], ...over };
}
