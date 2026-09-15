import { describe, expect, it } from "vitest";
import { bestLag, energyEnvelope, estimateSyncOffsetMs, toMono } from "./webcamSync";

const RATE = 8000;

/** Deterministic LCG noise so tests never flake. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
}

/** Speech-like bursts: random on/off segments of noise, length `ms`. */
function bursts(ms: number, seed: number): Float32Array {
  const out = new Float32Array(Math.round((RATE * ms) / 1000));
  const rnd = noise(seed);
  let i = 0;
  while (i < out.length) {
    const on = rnd() > -0.1;
    const len = Math.round(RATE * (0.08 + (rnd() + 0.5) * 0.5));
    for (let j = i; j < Math.min(out.length, i + len); j++)
      out[j] = on ? rnd() * 0.8 : rnd() * 0.01;
    i += len;
  }
  return out;
}

/** `delayMs` > 0 → the same content appears later in the result. */
function shifted(src: Float32Array, delayMs: number, gain: number, seed: number): Float32Array {
  const d = Math.round((RATE * delayMs) / 1000);
  const out = new Float32Array(src.length);
  const rnd = noise(seed);
  for (let i = 0; i < out.length; i++) {
    const j = i - d;
    out[i] = (j >= 0 && j < src.length ? (src[j] as number) * gain : 0) + rnd() * 0.02;
  }
  return out;
}

describe("estimateSyncOffsetMs", () => {
  const mic = bursts(40_000, 7);

  it.each([0, 120, 850, -430, 2500])(
    "recovers a %ims webcam delay within one envelope bin",
    (delay) => {
      const cam = shifted(mic, delay, 0.3, 99);
      const r = estimateSyncOffsetMs(
        { samples: mic, sampleRate: RATE },
        { samples: cam, sampleRate: RATE },
      );
      expect(r).not.toBeNull();
      expect(Math.abs((r?.offsetMs ?? 1e9) - delay)).toBeLessThanOrEqual(5);
      expect(r?.correlation).toBeGreaterThan(0.5);
    },
  );

  it("works across different sample rates", () => {
    const cam8k = shifted(mic, 300, 1, 3);
    const cam16k = new Float32Array(cam8k.length * 2);
    for (let i = 0; i < cam16k.length; i++) cam16k[i] = cam8k[i >> 1] as number;
    const r = estimateSyncOffsetMs(
      { samples: mic, sampleRate: RATE },
      { samples: cam16k, sampleRate: RATE * 2 },
    );
    expect(Math.abs((r?.offsetMs ?? 1e9) - 300)).toBeLessThanOrEqual(5);
  });

  it("returns null for silence or unrelated audio", () => {
    const silent = new Float32Array(mic.length);
    expect(
      estimateSyncOffsetMs(
        { samples: mic, sampleRate: RATE },
        { samples: silent, sampleRate: RATE },
      ),
    ).toBeNull();
    const other = bursts(40_000, 12345);
    const r = estimateSyncOffsetMs(
      { samples: mic, sampleRate: RATE },
      { samples: other, sampleRate: RATE },
      { minCorrelation: 0.6 },
    );
    expect(r).toBeNull();
  });

  it("returns null for empty or invalid input", () => {
    const empty = new Float32Array(0);
    expect(
      estimateSyncOffsetMs(
        { samples: empty, sampleRate: RATE },
        { samples: mic, sampleRate: RATE },
      ),
    ).toBeNull();
    expect(
      estimateSyncOffsetMs({ samples: mic, sampleRate: 0 }, { samples: mic, sampleRate: RATE }),
    ).toBeNull();
  });

  it("only looks at the first 30s", () => {
    // Identical first 30s, garbage afterwards → still zero offset.
    const cam = new Float32Array(mic.length);
    cam.set(mic.subarray(0, RATE * 30));
    cam.set(bursts(10_000, 5), RATE * 30);
    const r = estimateSyncOffsetMs(
      { samples: mic, sampleRate: RATE },
      { samples: cam, sampleRate: RATE },
    );
    expect(r?.offsetMs).toBe(0);
  });
});

describe("helpers", () => {
  it("bestLag finds an integer shift and prefers zero on flat input", () => {
    const ref = Float64Array.from([0, 1, 0, -1, 2, 0, 0, 0]);
    const target = Float64Array.from([0, 0, 0, 1, 0, -1, 2, 0]);
    expect(bestLag(ref, target, 3).lag).toBe(2);
    expect(bestLag(new Float64Array(8), new Float64Array(8), 3).lag).toBe(0);
  });

  it("energyEnvelope is mean-removed and windowed", () => {
    const env = energyEnvelope(
      Float32Array.from({ length: 1000 }, () => 0.5),
      1000,
      100,
      500,
    );
    expect(env.length).toBe(50);
    expect(Math.max(...env.map(Math.abs))).toBeCloseTo(0);
  });

  it("toMono averages channels", () => {
    expect([...toMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])])]).toEqual([0.5, 0.5]);
    expect(toMono([]).length).toBe(0);
  });
});
