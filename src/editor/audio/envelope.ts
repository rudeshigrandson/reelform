import type { Clip } from "../model/schema";
import { type DbEnvelope, rmsEnvelope } from "./dsp";
import type { AudioBufferLike } from "./graph";
import { type AudioSpeedRegion, SpeedMap, sourceSegments } from "./speedMap";

/**
 * Mic RMS envelope for ducking (ENGINEERING_SPEC §9.5). The graph samples the
 * envelope in OUTPUT time, while the decoded mic is in source time, so the
 * source envelope is re-sampled through clips and speed regions.
 */

export const DUCK_ENVELOPE_WINDOW_MS = 10;

/** Per-window RMS (dBFS) across all channels (energy mean), in source time. */
export function sourceRmsEnvelope(
  buffer: AudioBufferLike,
  windowMs = DUCK_ENVELOPE_WINDOW_MS,
): DbEnvelope {
  const channels = Math.max(0, buffer.numberOfChannels);
  if (channels === 0 || buffer.length === 0) {
    return { envelopeDb: [], sampleRateHz: 1000 / windowMs };
  }
  const per = Array.from({ length: channels }, (_, c) =>
    rmsEnvelope(buffer.getChannelData(c), buffer.sampleRate, windowMs),
  );
  const first = per[0] as DbEnvelope;
  if (channels === 1) return first;
  const envelopeDb = first.envelopeDb.map((_, i) => {
    let energy = 0;
    for (const env of per) {
      const db = env.envelopeDb[i] ?? Number.NEGATIVE_INFINITY;
      energy += Number.isFinite(db) ? 10 ** (db / 10) : 0;
    }
    return energy > 0 ? 10 * Math.log10(energy / channels) : Number.NEGATIVE_INFINITY;
  });
  return { envelopeDb, sampleRateHz: first.sampleRateHz };
}

/**
 * Re-sample a source-time envelope onto output time. Output time with no
 * source behind it (past the last clip) is silent.
 */
export function outputEnvelope(
  source: DbEnvelope,
  clips: readonly Clip[],
  speeds: readonly AudioSpeedRegion[] = [],
  windowMs = DUCK_ENVELOPE_WINDOW_MS,
): DbEnvelope {
  const segments = sourceSegments(clips, new SpeedMap(speeds));
  const endMs = segments.reduce((m, s) => Math.max(m, s.outputEndMs), 0);
  const n = Math.max(0, Math.ceil(endMs / windowMs));
  const envelopeDb = new Array<number>(n);
  let si = 0;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) * windowMs;
    while (si < segments.length && (segments[si]?.outputEndMs ?? 0) <= u) si++;
    const seg = segments[si];
    if (!seg || u < seg.outputStartMs) {
      envelopeDb[i] = Number.NEGATIVE_INFINITY;
      continue;
    }
    const srcMs = seg.sourceStartMs + (u - seg.outputStartMs) * seg.rate;
    const idx = Math.floor((srcMs / 1000) * source.sampleRateHz);
    envelopeDb[i] = source.envelopeDb[idx] ?? Number.NEGATIVE_INFINITY;
  }
  return { envelopeDb, sampleRateHz: 1000 / windowMs };
}

/** Output-time mic envelope, only when some region actually ducks. */
export function micDuckEnvelope(
  mic: AudioBufferLike | undefined,
  regions: readonly { duck: { enabled: boolean; amountDb: number } }[],
  clips: readonly Clip[],
  speeds: readonly AudioSpeedRegion[] = [],
): DbEnvelope | undefined {
  if (!mic || !regions.some((r) => r.duck.enabled && r.duck.amountDb > 0)) return undefined;
  const effectiveClips =
    clips.length > 0
      ? clips
      : [{ id: "source", sourceStartMs: 0, sourceEndMs: mic.duration * 1000, timelineStartMs: 0 }];
  return outputEnvelope(sourceRmsEnvelope(mic), effectiveClips, speeds);
}
