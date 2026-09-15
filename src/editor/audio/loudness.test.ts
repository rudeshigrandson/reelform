import {
  ABSOLUTE_GATE_LUFS,
  LoudnessMeter,
  gatedIntegratedLoudness,
  integratedLoudness,
  kWeightingCoefficients,
  normalizeGain,
  normalizeGainDb,
} from "./loudness";

function sine(freq: number, amp: number, seconds: number, sampleRate: number): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

const minus20dBFS = 10 ** (-20 / 20);

describe("K-weighting coefficients", () => {
  it("reproduce the BS.1770 48 kHz table", () => {
    const [shelf, hp] = kWeightingCoefficients(48_000);
    expect(shelf.b[0]).toBeCloseTo(1.53512485958697, 6);
    expect(shelf.b[1]).toBeCloseTo(-2.69169618940638, 6);
    expect(shelf.b[2]).toBeCloseTo(1.19839281085285, 6);
    expect(shelf.a[1]).toBeCloseTo(-1.69065929318241, 6);
    expect(shelf.a[2]).toBeCloseTo(0.73248077421585, 6);
    expect(hp.b).toEqual([1, -2, 1]);
    expect(hp.a[1]).toBeCloseTo(-1.99004745483398, 6);
    expect(hp.a[2]).toBeCloseTo(0.99007225036621, 6);
  });

  it("are stable at 44.1 kHz (poles inside the unit circle)", () => {
    for (const f of kWeightingCoefficients(44_100)) {
      expect(Math.abs(f.a[2])).toBeLessThan(1);
      expect(Math.abs(f.a[1])).toBeLessThan(1 + f.a[2]);
    }
  });
});

describe("integrated loudness", () => {
  for (const sr of [48_000, 44_100]) {
    it(`stereo 1 kHz sine at −20 dBFS reads −20 LUFS (±0.5) @ ${sr}`, () => {
      const s = sine(1000, minus20dBFS, 5, sr);
      expect(integratedLoudness([s, s], sr)).toBeGreaterThan(-20.5);
      expect(integratedLoudness([s, s], sr)).toBeLessThan(-19.5);
    });

    it(`mono 1 kHz sine at −20 dBFS reads −23 LUFS (±0.5) @ ${sr}`, () => {
      const l = integratedLoudness([sine(1000, minus20dBFS, 5, sr)], sr);
      expect(Math.abs(l - -23.01)).toBeLessThan(0.5);
    });
  }

  it("silence and too-short signals are −∞", () => {
    expect(integratedLoudness([new Float32Array(48_000 * 2)], 48_000)).toBe(
      Number.NEGATIVE_INFINITY,
    );
    expect(integratedLoudness([sine(1000, 0.5, 0.3, 48_000)], 48_000)).toBe(
      Number.NEGATIVE_INFINITY,
    );
    expect(integratedLoudness([], 48_000)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("absolute gate: appended digital silence does not lower the reading", () => {
    const sr = 48_000;
    const tone = sine(1000, minus20dBFS, 4, sr);
    const withSilence = new Float32Array(tone.length + sr * 10);
    withSilence.set(tone);
    const a = integratedLoudness([tone, tone], sr);
    const b = integratedLoudness([withSilence, withSilence], sr);
    // Only the few blocks straddling the tone/silence edge still count (≈0.17 LU);
    // an ungated mean over 14s would drop by 10·log10(14/4) ≈ 5.4 LU.
    expect(Math.abs(a - b)).toBeLessThan(0.3);
    const m = new LoudnessMeter(sr, 2);
    m.push([withSilence, withSilence]);
    const blocks = m.blockLoudness();
    // 137 blocks; ~37 carry the tone, the rest (filter tail + silence) are gated out.
    const gated = blocks.filter((l) => l <= ABSOLUTE_GATE_LUFS).length;
    expect(blocks).toHaveLength(137);
    expect(gated).toBeGreaterThan(90);
  });

  it("relative gate: a quiet (−60 dBFS) section 40 dB down is excluded", () => {
    const sr = 48_000;
    const loud = sine(1000, minus20dBFS, 4, sr);
    const quiet = sine(1000, 10 ** (-60 / 20), 20, sr);
    const both = new Float32Array(loud.length + quiet.length);
    both.set(loud);
    both.set(quiet, loud.length);
    const ref = integratedLoudness([loud, loud], sr);
    const mixed = integratedLoudness([both, both], sr);
    expect(Math.abs(mixed - ref)).toBeLessThan(0.3);
  });

  it("streaming in chunks equals one-shot", () => {
    const sr = 44_100;
    const s = sine(440, 0.3, 3, sr);
    const m = new LoudnessMeter(sr, 1);
    for (let i = 0; i < s.length; i += 1234) m.push([s.subarray(i, i + 1234)]);
    expect(m.integrated()).toBeCloseTo(integratedLoudness([s], sr), 9);
    expect(m.blockLoudness()).toHaveLength(30 - 3); // 30 hops → 27 blocks
  });

  it("pushing no channels is a no-op (does not hang)", () => {
    const m = new LoudnessMeter(48_000, 2);
    m.push([]);
    expect(m.blockLoudness()).toEqual([]);
    expect(m.integrated()).toBe(Number.NEGATIVE_INFINITY);
  });

  it("rejects an invalid configuration", () => {
    expect(() => new LoudnessMeter(0, 1)).toThrow();
    expect(() => new LoudnessMeter(48_000, 0)).toThrow();
  });
});

describe("gating on block values", () => {
  it("applies −70 absolute and −10 LU relative gates", () => {
    expect(gatedIntegratedLoudness([-80, -75])).toBe(Number.NEGATIVE_INFINITY);
    expect(gatedIntegratedLoudness([-20, -20, -80])).toBeCloseTo(-20, 9);
    // -45 is > -70 but below (mean(-20,-20,-45) ≈ -21.7) − 10 → gated out.
    expect(gatedIntegratedLoudness([-20, -20, -45])).toBeCloseTo(-20, 9);
    expect(gatedIntegratedLoudness([])).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("normalize", () => {
  it("targets −16 LUFS and never boosts silence", () => {
    expect(normalizeGainDb(-23)).toBeCloseTo(7);
    expect(normalizeGainDb(-10)).toBeCloseTo(-6);
    expect(normalizeGainDb(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(normalizeGainDb(-40, -16, 12)).toBe(12);
    expect(normalizeGain(-16)).toBe(1);
  });

  it("normalized sine measures −16 LUFS", () => {
    const sr = 48_000;
    const s = sine(1000, minus20dBFS, 3, sr);
    const g = normalizeGain(integratedLoudness([s, s], sr));
    const n = s.map((v) => v * g);
    expect(integratedLoudness([n, n], sr)).toBeCloseTo(-16, 1);
  });
});
