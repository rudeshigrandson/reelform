import { describe, expect, it } from "vitest";
import { formatPlaybackTime } from "./format";

describe("formatPlaybackTime", () => {
  it("formats zero", () => expect(formatPlaybackTime(0)).toBe("00:00.000"));
  it("formats sub-second", () => expect(formatPlaybackTime(340)).toBe("00:00.340"));
  it("formats seconds and minutes", () => {
    expect(formatPlaybackTime(12_340)).toBe("00:12.340");
    expect(formatPlaybackTime(64_000)).toBe("01:04.000");
    expect(formatPlaybackTime(59 * 60_000 + 59_999)).toBe("59:59.999");
  });
  it("adds hours at ≥ 1h", () => {
    expect(formatPlaybackTime(3_600_000)).toBe("1:00:00.000");
    expect(formatPlaybackTime(3_723_450)).toBe("1:02:03.450");
  });
  it("clamps negative and non-finite to zero", () => {
    expect(formatPlaybackTime(-5)).toBe("00:00.000");
    expect(formatPlaybackTime(Number.NaN)).toBe("00:00.000");
    expect(formatPlaybackTime(Number.POSITIVE_INFINITY)).toBe("00:00.000");
  });
  it("rounds .9995 up across the second/minute carry", () => {
    expect(formatPlaybackTime(999.5)).toBe("00:01.000");
    expect(formatPlaybackTime(59_999.5)).toBe("01:00.000");
    expect(formatPlaybackTime(12_339.4)).toBe("00:12.339");
  });
});
