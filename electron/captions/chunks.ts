/**
 * Silence-aware chunk planning (ENGINEERING_SPEC §9.6: "silence split into
 * ≤ 5-minute chunks"). Pure: given the WAV duration and detected silences it
 * picks cut points; the injected splitter does the detection and the cutting.
 */

export const MAX_CHUNK_MS = 5 * 60 * 1000;

export interface TimeSpan {
  startMs: number;
  endMs: number;
}

/**
 * Split `[0, durationMs]` into contiguous chunks of at most `maxChunkMs`.
 * Each cut lands on the midpoint of the latest silence that keeps the chunk
 * within the limit; with no usable silence the chunk is hard-cut at the limit.
 * Silences may be unsorted/overlapping/out of range; invalid ones are ignored.
 */
export function planChunks(
  durationMs: number,
  silences: readonly TimeSpan[],
  maxChunkMs: number = MAX_CHUNK_MS,
): TimeSpan[] {
  if (!(maxChunkMs > 0)) throw new RangeError("maxChunkMs must be > 0");
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];

  const mids = silences
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs >= s.startMs)
    .map((s) => (s.startMs + s.endMs) / 2)
    .filter((m) => m > 0 && m < durationMs)
    .sort((a, b) => a - b);

  const chunks: TimeSpan[] = [];
  let start = 0;
  while (durationMs - start > maxChunkMs) {
    const limit = start + maxChunkMs;
    let cut = limit;
    // Latest silence midpoint in (start, limit].
    for (let i = mids.length - 1; i >= 0; i--) {
      const m = mids[i];
      if (m === undefined) continue;
      if (m <= limit && m > start) {
        cut = m;
        break;
      }
    }
    chunks.push({ startMs: start, endMs: cut });
    start = cut;
  }
  chunks.push({ startMs: start, endMs: durationMs });
  return chunks;
}
