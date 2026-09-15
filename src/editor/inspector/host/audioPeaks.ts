import type { DecodedAudio } from "./types";

/** Peak |amplitude| per bucket across all channels, 0..1 — feeds `MiniWaveform`. */
export function peaksFromAudio(audio: Pick<DecodedAudio, "channels">, buckets: number): number[] {
  const n = Math.floor(buckets);
  const len = audio.channels.reduce((m, c) => Math.max(m, c.length), 0);
  if (!(n > 0) || len === 0) return [];
  const out = new Array<number>(Math.min(n, len)).fill(0);
  const size = len / out.length;
  for (const ch of audio.channels) {
    for (let b = 0; b < out.length; b++) {
      const start = Math.floor(b * size);
      const end = Math.min(ch.length, Math.max(start + 1, Math.floor((b + 1) * size)));
      let m = out[b] as number;
      for (let i = start; i < end; i++) {
        const v = Math.abs(ch[i] as number);
        if (v > m) m = v;
      }
      out[b] = Math.min(1, m);
    }
  }
  return out;
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
