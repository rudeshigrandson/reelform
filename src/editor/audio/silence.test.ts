import { analyzeSilence, analyzeSilenceEnvelope } from "./silence";

const SR = 1000; // 1 sample per ms keeps edge arithmetic readable

/** Builds a signal from [durationMs, amplitude] runs. */
function signal(...runs: Array<[number, number]>): Float32Array {
  const total = runs.reduce((s, [d]) => s + d, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const [d, a] of runs) {
    out.fill(a, o, o + d);
    o += d;
  }
  return out;
}

describe("analyzeSilence", () => {
  const params = { thresholdDb: -40, minSilenceMs: 700 };

  it("finds interior gaps with exact edges and a preview label", () => {
    const s = signal([1000, 0.5], [800, 0], [500, 0.5], [2000, 0.001], [200, 0.5]);
    const r = analyzeSilence([s], SR, params);
    expect(r.gaps).toEqual([
      { startMs: 1000, endMs: 1800 },
      { startMs: 2300, endMs: 4300 },
    ]);
    expect(r.summary).toEqual({ count: 2, totalMs: 2800 });
    expect(r.label).toBe("Would remove 2 gaps (00:03 total)");
  });

  it("drops a gap one window shorter than the minimum, keeps one exactly at it", () => {
    const short = analyzeSilence([signal([100, 0.5], [690, 0], [100, 0.5])], SR, params);
    expect(short.gaps).toEqual([]);
    expect(short.label).toBe("No silent gaps found");
    const exact = analyzeSilence([signal([100, 0.5], [700, 0], [100, 0.5])], SR, params);
    expect(exact.gaps).toEqual([{ startMs: 100, endMs: 800 }]);
  });

  it("includes leading and trailing silence", () => {
    const r = analyzeSilence([signal([1000, 0], [100, 0.5], [900, 0])], SR, params);
    expect(r.gaps).toEqual([
      { startMs: 0, endMs: 1000 },
      { startMs: 1100, endMs: 2000 },
    ]);
  });

  it("threshold is inclusive (level == threshold is silent)", () => {
    const amp = 10 ** (-40 / 20);
    const r = analyzeSilence([signal([100, 0.5], [1000, amp])], SR, params);
    expect(r.gaps).toHaveLength(1);
    const louder = analyzeSilence([signal([100, 0.5], [1000, amp * 1.01])], SR, params);
    expect(louder.gaps).toHaveLength(0);
  });

  it("all silence → one gap; empty input → none; stereo mixed to mono", () => {
    expect(analyzeSilence([new Float32Array(3000)], SR, params).gaps).toEqual([
      { startMs: 0, endMs: 3000 },
    ]);
    expect(analyzeSilence([new Float32Array(0)], SR, params).gaps).toEqual([]);
    const l = signal([1000, 0.5], [1000, 0]);
    const r = signal([1000, 0], [1000, 0]);
    expect(analyzeSilence([l, r], SR, params).gaps).toEqual([{ startMs: 1000, endMs: 2000 }]);
  });

  it("works from a cached envelope", () => {
    const r = analyzeSilenceEnvelope(
      { envelopeDb: [-10, -90, -90, -10], sampleRateHz: 2 },
      {
        thresholdDb: -40,
        minSilenceMs: 1000,
      },
    );
    expect(r.gaps).toEqual([{ startMs: 500, endMs: 1500 }]);
  });
});
