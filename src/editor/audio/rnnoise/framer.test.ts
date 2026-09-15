import { describe, expect, it } from "vitest";
import { RNNOISE_FRAME_SIZE, RNNOISE_PCM_SCALE, RnnoiseFramer } from "./framer";

const QUANTUM = 128;

function run(framer: RnnoiseFramer, input: Float32Array, quantum = QUANTUM): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += quantum) {
    const end = Math.min(input.length, i + quantum);
    framer.process(input.subarray(i, end), out.subarray(i, end));
  }
  return out;
}

describe("RnnoiseFramer", () => {
  it("hands the denoiser full 480-sample frames in int16 range", () => {
    const frames: Float32Array[] = [];
    const framer = new RnnoiseFramer((f) => {
      frames.push(f.slice());
      return 0.9;
    });
    const input = new Float32Array(RNNOISE_FRAME_SIZE * 3).map((_, i) => (i % 100) / 100 - 0.5);
    run(framer, input);
    expect(frames).toHaveLength(3);
    for (const f of frames) expect(f.length).toBe(RNNOISE_FRAME_SIZE);
    expect(frames[1]?.[7]).toBeCloseTo(
      (input[RNNOISE_FRAME_SIZE + 7] as number) * RNNOISE_PCM_SCALE,
      3,
    );
    expect(framer.lastVad).toBe(0.9);
  });

  it("identity denoiser reproduces the input delayed by exactly one frame", () => {
    const framer = new RnnoiseFramer(() => 0);
    const input = new Float32Array(RNNOISE_FRAME_SIZE * 4).map((_, i) => Math.sin(i / 7) * 0.8);
    const out = run(framer, input);
    expect(framer.latencySamples).toBe(RNNOISE_FRAME_SIZE);
    for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) expect(out[i]).toBe(0);
    for (let i = RNNOISE_FRAME_SIZE; i < input.length; i++) {
      expect(out[i]).toBeCloseTo(input[i - RNNOISE_FRAME_SIZE] as number, 5);
    }
  });

  it("applies the denoiser's in-place changes and works with odd quantum sizes", () => {
    const framer = new RnnoiseFramer((f) => {
      for (let i = 0; i < f.length; i++) f[i] = (f[i] as number) * 0.25;
      return 0;
    });
    const input = new Float32Array(RNNOISE_FRAME_SIZE * 3).fill(0.4);
    const out = run(framer, input, 97);
    expect(out[RNNOISE_FRAME_SIZE * 2 + 5]).toBeCloseTo(0.1, 6);
  });

  it("treats non-finite input as silence", () => {
    const framer = new RnnoiseFramer(() => 0);
    const input = new Float32Array(RNNOISE_FRAME_SIZE * 2).fill(Number.NaN);
    const out = run(framer, input);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});
