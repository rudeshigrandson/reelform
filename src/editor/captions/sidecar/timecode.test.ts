import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatTimecode, parseTimecode, parseTimingLine } from "./timecode";

describe("timecode", () => {
  it("formats SRT and VTT timestamps", () => {
    expect(formatTimecode(0, ",")).toBe("00:00:00,000");
    expect(formatTimecode(3_723_004, ",")).toBe("01:02:03,004");
    expect(formatTimecode(59_999, ".")).toBe("00:00:59.999");
    expect(formatTimecode(100 * 3_600_000, ".")).toBe("100:00:00.000");
  });

  it("clamps and rounds bad input", () => {
    expect(formatTimecode(-50, ",")).toBe("00:00:00,000");
    expect(formatTimecode(Number.NaN, ",")).toBe("00:00:00,000");
    expect(formatTimecode(1234.6, ".")).toBe("00:00:01.235");
  });

  it("parses variants", () => {
    expect(parseTimecode("01:02:03,004")).toBe(3_723_004);
    expect(parseTimecode("01:02:03.004")).toBe(3_723_004);
    expect(parseTimecode("02:03.004")).toBe(123_004);
    expect(parseTimecode("00:00:01.5")).toBe(1500);
    expect(parseTimecode(" 00:00:01,000 ")).toBe(1000);
  });

  it("rejects malformed timestamps", () => {
    for (const bad of [
      "",
      "1:2",
      "00:60:00,000",
      "00:00:61,000",
      "aa:bb:cc,ddd",
      "00:00:01,0000",
      "00:00:01",
    ]) {
      expect(parseTimecode(bad)).toBeNull();
    }
  });

  it("parses timing lines and ignores cue settings", () => {
    expect(parseTimingLine("00:00:01.000 --> 00:00:02.500 align:start position:10%")).toEqual({
      startMs: 1000,
      endMs: 2500,
    });
    expect(parseTimingLine("00:01,000-->00:02,000")).toBeNull();
    expect(parseTimingLine("00:00:01,000 --> nope")).toBeNull();
  });

  it("property: format → parse is identity on integer ms", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 * 3_600_000 }),
        fc.constantFrom(",", "."),
        (ms, sep) => {
          expect(parseTimecode(formatTimecode(ms, sep as "," | "."))).toBe(ms);
        },
      ),
    );
  });
});
