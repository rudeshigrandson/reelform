import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_LENGTH_MS,
  INTERRUPT_FREE_BYTES,
  MIN_FREE_BYTES_TO_START,
  canStartWithFreeBytes,
  diskStatus,
  effectiveMaxLengthMs,
  maxLengthReached,
  recordedDurationMs,
  selectRecordingsToPrune,
} from "./rules";

const DAY = 86_400_000;

describe("disk thresholds", () => {
  it("classifies exact boundaries", () => {
    expect(diskStatus(MIN_FREE_BYTES_TO_START)).toBe("ok");
    expect(diskStatus(MIN_FREE_BYTES_TO_START - 1)).toBe("low");
    expect(diskStatus(INTERRUPT_FREE_BYTES)).toBe("low");
    expect(diskStatus(INTERRUPT_FREE_BYTES - 1)).toBe("critical");
    expect(diskStatus(Number.NaN)).toBe("ok");
    expect(canStartWithFreeBytes(2 * 1024 ** 3)).toBe(true);
    expect(canStartWithFreeBytes(2 * 1024 ** 3 - 1)).toBe(false);
  });
});

describe("max length", () => {
  it("defaults to 3h for invalid settings", () => {
    expect(DEFAULT_MAX_LENGTH_MS).toBe(10_800_000);
    for (const v of [undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(effectiveMaxLengthMs(v)).toBe(DEFAULT_MAX_LENGTH_MS);
    }
    expect(effectiveMaxLengthMs(60_000)).toBe(60_000);
    expect(maxLengthReached(59_999, 60_000)).toBe(false);
    expect(maxLengthReached(60_000, 60_000)).toBe(true);
  });
});

describe("recordedDurationMs", () => {
  it("excludes closed and open pauses, clipped to the window", () => {
    expect(recordedDurationMs(1000, 11_000, [])).toBe(10_000);
    expect(recordedDurationMs(1000, 11_000, [{ startMs: 3000, endMs: 5000 }])).toBe(8000);
    expect(recordedDurationMs(1000, 11_000, [{ startMs: 9000, endMs: null }])).toBe(8000);
    expect(recordedDurationMs(1000, 11_000, [{ startMs: 0, endMs: 2000 }])).toBe(9000);
    expect(recordedDurationMs(5000, 1000, [])).toBe(0);
  });

  it("property: 0 ≤ recorded ≤ wall elapsed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e7 }),
        fc.integer({ min: 0, max: 1e7 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 2e7 }), fc.integer({ min: 0, max: 1e6 }))),
        (start, len, pauses) => {
          // Non-overlapping pauses in order, like the controller produces.
          const sorted = [...pauses].sort((a, b) => a[0] - b[0]);
          let cursor = -1;
          const ranges = [];
          for (const [s, d] of sorted) {
            const st = Math.max(s, cursor);
            ranges.push({ startMs: st, endMs: st + d });
            cursor = st + d;
          }
          const r = recordedDurationMs(start, start + len, ranges);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(len);
        },
      ),
    );
  });
});

describe("selectRecordingsToPrune", () => {
  const now = 100 * DAY;
  const entry = (id: string, ageDays: number, over: object = {}) => ({
    id,
    createdAtMs: now - ageDays * DAY,
    openedAtMs: null,
    attachedToProject: false,
    ...over,
  });

  it("prunes only old, never-opened, unattached recordings", () => {
    const list = [
      entry("old", 15),
      entry("young", 13),
      entry("exact", 14),
      entry("opened", 30, { openedAtMs: now - 29 * DAY }),
      entry("attached", 30, { attachedToProject: true }),
    ];
    expect(selectRecordingsToPrune(list, now, 14)).toEqual(["old"]);
  });

  it("days ≤ 0 or invalid disables pruning", () => {
    const list = [entry("old", 400)];
    expect(selectRecordingsToPrune(list, now, 0)).toEqual([]);
    expect(selectRecordingsToPrune(list, now, Number.NaN)).toEqual([]);
  });
});
