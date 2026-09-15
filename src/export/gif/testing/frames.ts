import type { RgbaFrame } from "../types";

/** Shared synthetic-frame fixtures for GIF tests. */

export type Rgba = readonly [number, number, number, number?];

export function frameFromFn(
  width: number,
  height: number,
  fn: (x: number, y: number) => Rgba,
): RgbaFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  return { width, height, data };
}

export const solidFrame = (width: number, height: number, c: Rgba): RgbaFrame =>
  frameFromFn(width, height, () => c);

/** Deterministic LCG noise frame. */
export function noiseFrame(width: number, height: number, seed = 1): RgbaFrame {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s >>> 24;
  };
  return frameFromFn(width, height, () => [rnd(), rnd(), rnd()]);
}

export const gradientFrame = (width: number, height: number): RgbaFrame =>
  frameFromFn(width, height, (x, y) => [
    Math.round((x / Math.max(1, width - 1)) * 255),
    Math.round((y / Math.max(1, height - 1)) * 255),
    128,
  ]);

/** Concatenate encoder chunks into one file. */
export function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export function rgbAt(frame: RgbaFrame, x: number, y: number): [number, number, number] {
  const o = (y * frame.width + x) * 4;
  return [frame.data[o] ?? 0, frame.data[o + 1] ?? 0, frame.data[o + 2] ?? 0];
}
