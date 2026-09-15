#!/usr/bin/env node
/**
 * Deterministic click-sound synthesis (ENGINEERING_SPEC §9.5 "Click sounds: 3
 * bundled packs"). Pure math — no samples, no randomness except a seeded PRNG —
 * so re-running produces byte-identical files that are committed.
 *
 * Output: public/sounds/<pack>/click.wav — 48 kHz, mono, PCM16, < 150 ms.
 *
 * Usage: node scripts/generate-click-sounds.mjs [--out <dir>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SAMPLE_RATE = 48_000;

/** Mulberry32 — tiny seeded PRNG for the noise transients. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each pack: duration (s) and a per-sample generator (t seconds, rand) → [-1, 1]. */
export const PACKS = {
  // Short damped sine "tick" with a gentle attack.
  soft: {
    durationS: 0.06,
    seed: 1,
    sample: (t) => {
      const attack = Math.min(1, t / 0.002);
      return 0.55 * attack * Math.exp(-t / 0.012) * Math.sin(2 * Math.PI * 1800 * t);
    },
  },
  // Keyboard-like: sharp noise transient + two resonant body modes (press + release).
  mechanical: {
    durationS: 0.11,
    seed: 7,
    sample: (t, rand) => {
      const noise = (rand() * 2 - 1) * Math.exp(-t / 0.0025);
      const body =
        Math.exp(-t / 0.018) *
        (0.6 * Math.sin(2 * Math.PI * 2400 * t) + 0.3 * Math.sin(2 * Math.PI * 5200 * t));
      const t2 = t - 0.055;
      const release =
        t2 > 0
          ? 0.35 *
            ((rand() * 2 - 1) * Math.exp(-t2 / 0.002) +
              Math.exp(-t2 / 0.01) * Math.sin(2 * Math.PI * 3100 * t2))
          : 0;
      return 0.5 * noise + 0.45 * body + release;
    },
  },
  // Bubbly "pop": downward pitch sweep with exponential decay.
  pop: {
    durationS: 0.08,
    seed: 3,
    sample: (t) => {
      const f0 = 900;
      const f1 = 260;
      const k = 40;
      // Phase of an exponentially sweeping sine: ∫ f(t) dt, f(t) = f1 + (f0 - f1) e^{-kt}.
      const phase = 2 * Math.PI * (f1 * t + ((f0 - f1) / k) * (1 - Math.exp(-k * t)));
      const attack = Math.min(1, t / 0.001);
      return 0.7 * attack * Math.exp(-t / 0.02) * Math.sin(phase);
    },
  },
};

/** Render a pack to Int16 PCM with a short fade-out so the tail never clicks. */
export function renderPack(pack) {
  const n = Math.round(pack.durationS * SAMPLE_RATE);
  const rand = prng(pack.seed);
  const fade = Math.round(0.005 * SAMPLE_RATE);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let v = pack.sample(t, rand);
    if (i >= n - fade) v *= (n - i) / fade;
    v = Math.max(-1, Math.min(1, v));
    pcm[i] = Math.round(v * 32767);
  }
  return pcm;
}

/** RIFF/WAVE PCM16 mono encoder. */
export function encodeWav(pcm, sampleRate = SAMPLE_RATE) {
  const dataBytes = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return buf;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outIdx = process.argv.indexOf("--out");
  const outDir =
    outIdx > 0 && process.argv[outIdx + 1]
      ? resolve(process.argv[outIdx + 1])
      : join(root, "public", "sounds");
  for (const [name, pack] of Object.entries(PACKS)) {
    const dir = join(outDir, name);
    mkdirSync(dir, { recursive: true });
    const wav = encodeWav(renderPack(pack));
    writeFileSync(join(dir, "click.wav"), wav);
    console.log(`sounds/${name}/click.wav  ${wav.length} bytes`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
