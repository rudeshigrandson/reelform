import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { lzwEncode, lzwMinCodeSize } from "./lzw";
import { lzwDecode } from "./testing/gifDecoder";

/** Strip the min-code-size byte and sub-block framing; assert block rules. */
function unblock(bytes: Uint8Array): { minCodeSize: number; data: Uint8Array } {
  const minCodeSize = bytes[0] ?? 0;
  const parts: number[] = [];
  let p = 1;
  for (;;) {
    const len = bytes[p++] ?? -1;
    if (len === 0) break;
    expect(len).toBeGreaterThan(0);
    expect(len).toBeLessThanOrEqual(255);
    for (let i = 0; i < len; i++) parts.push(bytes[p++] ?? 0);
  }
  expect(p).toBe(bytes.length);
  return { minCodeSize, data: Uint8Array.from(parts) };
}

function roundTrip(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const { minCodeSize: m, data } = unblock(lzwEncode(indices, minCodeSize).toBytes());
  expect(m).toBe(minCodeSize);
  return lzwDecode(data, m, indices.length);
}

describe("lzwMinCodeSize", () => {
  it("is at least 2 and covers the table", () => {
    expect(lzwMinCodeSize(2)).toBe(2);
    expect(lzwMinCodeSize(4)).toBe(2);
    expect(lzwMinCodeSize(8)).toBe(3);
    expect(lzwMinCodeSize(32)).toBe(5);
    expect(lzwMinCodeSize(256)).toBe(8);
  });
});

describe("lzwEncode", () => {
  it("round-trips an empty-ish and single index stream", () => {
    expect(Array.from(roundTrip(new Uint8Array([3]), 2))).toEqual([3]);
    expect(Array.from(roundTrip(new Uint8Array(0), 2))).toEqual([]);
  });

  it("round-trips a long constant run (KwKwK case)", () => {
    const run = new Uint8Array(50_000).fill(7);
    expect(roundTrip(run, 8)).toEqual(run);
  });

  it("round-trips high-entropy data that forces table clears at 12 bits", () => {
    const n = 200_000;
    const data = new Uint8Array(n);
    let s = 12345;
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      data[i] = s >>> 24;
    }
    expect(roundTrip(data, 8)).toEqual(data);
  });

  it("rejects invalid min code sizes", () => {
    expect(() => lzwEncode([0], 1)).toThrow(RangeError);
    expect(() => lzwEncode([0], 9)).toThrow(RangeError);
  });

  it("property: decode(encode(x)) === x for any code size", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 2, max: 8 })
          .chain((m) =>
            fc.tuple(
              fc.constant(m),
              fc.array(fc.integer({ min: 0, max: (1 << m) - 1 }), { maxLength: 6000 }),
            ),
          ),
        ([m, arr]) => {
          const input = Uint8Array.from(arr);
          expect(roundTrip(input, m)).toEqual(input);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("property: low-entropy runs round-trip (exercises code growth)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 400 })), {
          maxLength: 200,
        }),
        (runs) => {
          const out: number[] = [];
          for (const [v, len] of runs) for (let i = 0; i < len; i++) out.push(v);
          const input = Uint8Array.from(out);
          expect(roundTrip(input, 2)).toEqual(input);
        },
      ),
      { numRuns: 100 },
    );
  });
});
