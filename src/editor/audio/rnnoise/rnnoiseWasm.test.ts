import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { RNNOISE_FRAME_SIZE, RnnoiseFramer } from "./framer";
import { createRnnoiseDenoiser } from "./rnnoiseWasm";

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("@jitsi/rnnoise-wasm/dist/rnnoise.wasm");
const bytes = readFileSync(wasmPath);

/** Deterministic white noise (LCG), amplitude ±amp. */
function noise(n: number, amp: number, seed = 1): Float32Array {
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    out[i] = ((s / 0xffffffff) * 2 - 1) * amp;
  }
  return out;
}

const rms = (a: Float32Array, from = 0): number => {
  let e = 0;
  for (let i = from; i < a.length; i++) e += (a[i] as number) ** 2;
  return Math.sqrt(e / Math.max(1, a.length - from));
};

describe("createRnnoiseDenoiser (real wasm)", () => {
  it("initializes the bundled binary and suppresses quiet stationary hiss", () => {
    const d = createRnnoiseDenoiser(bytes);
    const framer = new RnnoiseFramer(d.denoise);
    // Room-tone level hiss (~−54 dBFS): RNNoise removes almost all of it.
    const input = noise(48_000 * 3, 0.002);
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 128) {
      framer.process(input.subarray(i, i + 128), output.subarray(i, i + 128));
    }
    // Skip the first two seconds while the model adapts.
    expect(rms(output, 96_000)).toBeLessThan(rms(input, 96_000) * 0.1);
    expect(output.every(Number.isFinite)).toBe(true);
    // Noise isn't speech: the voice probability stays low.
    expect(framer.lastVad).toBeGreaterThanOrEqual(0);
    expect(framer.lastVad).toBeLessThan(0.2);
    d.destroy();
    d.destroy();
    // Destroyed denoisers leave frames untouched.
    const frame = new Float32Array(RNNOISE_FRAME_SIZE).fill(123);
    expect(d.denoise(frame)).toBe(0);
    expect(frame[0]).toBe(123);
  });

  it("rejects a non-RNNoise binary", () => {
    expect(() => createRnnoiseDenoiser(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))).toThrow();
  });
});
