import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_CHUNK_MS, planChunks } from "./chunks";

const MIN = 60_000;

describe("planChunks", () => {
  it("returns no chunks for empty or invalid durations", () => {
    expect(planChunks(0, [])).toEqual([]);
    expect(planChunks(-5, [])).toEqual([]);
    expect(planChunks(Number.NaN, [])).toEqual([]);
  });

  it("keeps short audio as a single chunk", () => {
    expect(planChunks(4 * MIN, [{ startMs: 1000, endMs: 2000 }])).toEqual([
      { startMs: 0, endMs: 4 * MIN },
    ]);
  });

  it("exactly 5 minutes is one chunk", () => {
    expect(planChunks(MAX_CHUNK_MS, [])).toEqual([{ startMs: 0, endMs: MAX_CHUNK_MS }]);
  });

  it("cuts at the latest silence midpoint within the limit", () => {
    const chunks = planChunks(12 * MIN, [
      { startMs: 2 * MIN, endMs: 2 * MIN + 1000 },
      { startMs: 4 * MIN, endMs: 4 * MIN + 2000 },
      { startMs: 6 * MIN, endMs: 6 * MIN + 1000 },
    ]);
    expect(chunks[0]).toEqual({ startMs: 0, endMs: 4 * MIN + 1000 });
    expect(chunks[1]?.startMs).toBe(4 * MIN + 1000);
  });

  it("hard-cuts at the limit when there is no silence", () => {
    expect(planChunks(11 * MIN, [])).toEqual([
      { startMs: 0, endMs: 5 * MIN },
      { startMs: 5 * MIN, endMs: 10 * MIN },
      { startMs: 10 * MIN, endMs: 11 * MIN },
    ]);
  });

  it("ignores silences outside the audio or inverted", () => {
    const chunks = planChunks(
      7 * MIN,
      [
        { startMs: -1000, endMs: -10 },
        { startMs: 9 * MIN, endMs: 10 * MIN },
        { startMs: 3 * MIN, endMs: 2 * MIN },
      ],
      5 * MIN,
    );
    expect(chunks).toEqual([
      { startMs: 0, endMs: 5 * MIN },
      { startMs: 5 * MIN, endMs: 7 * MIN },
    ]);
  });

  it("rejects a non-positive max", () => {
    expect(() => planChunks(1000, [], 0)).toThrow(RangeError);
  });

  it("property: contiguous cover of [0, duration], every chunk in (0, max]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 * MIN }),
        fc.array(
          fc.tuple(fc.integer({ min: -MIN, max: 61 * MIN }), fc.integer({ min: 0, max: 5000 })),
          {
            maxLength: 40,
          },
        ),
        fc.integer({ min: 1000, max: 10 * MIN }),
        (duration, raw, max) => {
          const silences = raw.map(([s, len]) => ({ startMs: s, endMs: s + len }));
          const chunks = planChunks(duration, silences, max);
          expect(chunks[0]?.startMs).toBe(0);
          expect(chunks.at(-1)?.endMs).toBe(duration);
          chunks.forEach((c, i) => {
            expect(c.endMs - c.startMs).toBeGreaterThan(0);
            expect(c.endMs - c.startMs).toBeLessThanOrEqual(max);
            if (i > 0) expect(c.startMs).toBe(chunks[i - 1]?.endMs);
          });
        },
      ),
    );
  });

  it("property: interior cuts are silence midpoints or hard limits", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 * MIN }),
        fc.array(fc.integer({ min: 0, max: 30 * MIN }), { maxLength: 20 }),
        (duration, starts) => {
          const silences = starts.map((s) => ({ startMs: s, endMs: s + 400 }));
          const mids = new Set(silences.map((s) => s.startMs + 200));
          const chunks = planChunks(duration, silences);
          for (const c of chunks.slice(0, -1)) {
            const isMid = mids.has(c.endMs);
            const isLimit = c.endMs - c.startMs === MAX_CHUNK_MS;
            expect(isMid || isLimit).toBe(true);
          }
        },
      ),
    );
  });
});
