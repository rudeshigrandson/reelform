import fc from "fast-check";
import { parseRange } from "./range";

describe("parseRange", () => {
  it("no header → none", () => {
    expect(parseRange(null, 100)).toEqual({ kind: "none" });
    expect(parseRange(undefined, 100)).toEqual({ kind: "none" });
  });

  it("explicit range", () => {
    expect(parseRange("bytes=0-499", 1000)).toEqual({ kind: "range", start: 0, end: 499 });
    expect(parseRange("bytes=10-10", 1000)).toEqual({ kind: "range", start: 10, end: 10 });
  });

  it("end past size clamps to last byte", () => {
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ kind: "range", start: 900, end: 999 });
  });

  it("open-ended range", () => {
    expect(parseRange("bytes=500-", 1000)).toEqual({ kind: "range", start: 500, end: 999 });
    expect(parseRange("bytes=0-", 1)).toEqual({ kind: "range", start: 0, end: 0 });
  });

  it("suffix range, including longer than the file", () => {
    expect(parseRange("bytes=-200", 1000)).toEqual({ kind: "range", start: 800, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ kind: "range", start: 0, end: 999 });
  });

  it("unsatisfiable", () => {
    expect(parseRange("bytes=1000-", 1000)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=1000-1200", 1000)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=-0", 1000)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=-10", 0)).toEqual({ kind: "unsatisfiable" });
  });

  it("invalid or multi-range headers are ignored", () => {
    for (const h of [
      "bytes=5-1",
      "items=0-1",
      "bytes=",
      "bytes=-",
      "bytes=a-b",
      "bytes=0-1,5-6",
      "0-1",
    ]) {
      expect(parseRange(h, 1000)).toEqual({ kind: "none" });
    }
  });

  it("tolerates case and whitespace in the unit", () => {
    expect(parseRange(" Bytes = 1-2 ", 10)).toEqual({ kind: "range", start: 1, end: 2 });
  });

  it("property: satisfiable ranges always lie within the entity", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e9 }),
        fc.option(fc.integer({ min: 0, max: 2e9 }), { nil: undefined }),
        fc.option(fc.integer({ min: 0, max: 2e9 }), { nil: undefined }),
        (size, a, b) => {
          const header = `bytes=${a ?? ""}-${b ?? ""}`;
          const r = parseRange(header, size);
          if (r.kind === "range") {
            expect(r.start).toBeGreaterThanOrEqual(0);
            expect(r.end).toBeLessThan(size);
            expect(r.start).toBeLessThanOrEqual(r.end);
          }
          if (r.kind === "unsatisfiable") {
            // Only when no byte of the request exists.
            expect(
              size === 0 || (a !== undefined && a >= size) || (a === undefined && b === 0),
            ).toBe(true);
          }
        },
      ),
    );
  });
});
