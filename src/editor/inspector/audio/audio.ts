import { clamp } from "../controls";
import {
  AUDIO_LIMITS,
  DEFAULT_DUCK,
  SILENT_DB,
  TRACK_KINDS,
  type AudioRegion,
  type AudioSettings,
  type AvailableTracks,
  type MasterSettings,
  type NewAudioRegion,
  type TrackKind,
} from "./types";

/** Pure audio-settings logic for the S17 inspector. No DOM, no store. */

const { minDb, maxDb } = AUDIO_LIMITS;

/** Slider resolution: 0.1 dB per step across [minDb, maxDb]. Position 0 = −∞. */
export const SLIDER_STEPS = Math.round((maxDb - minDb) * 10);

/** Normalizes a dB value: NaN / ≤ floor → −∞, above cap → +12. */
export function clampDb(db: number): number {
  if (Number.isNaN(db) || db <= minDb) return SILENT_DB;
  return Math.min(db, maxDb);
}

/** dB → linear gain. −∞ → 0; capped at +12 dB. */
export function dbToGain(db: number): number {
  if (Number.isNaN(db) || db === -Infinity) return 0;
  return 10 ** (Math.min(db, maxDb) / 20);
}

/** Linear gain → dB. ≤ 0 → −∞; capped at +12 dB. */
export function gainToDb(gain: number): number {
  if (!(gain > 0)) return SILENT_DB;
  return Math.min(20 * Math.log10(gain), maxDb);
}

export function dbToSliderPosition(db: number): number {
  const d = clampDb(db);
  if (d === SILENT_DB) return 0;
  return clamp(Math.round(((d - minDb) / (maxDb - minDb)) * SLIDER_STEPS), 1, SLIDER_STEPS);
}

export function sliderPositionToDb(position: number): number {
  if (!Number.isFinite(position)) return SILENT_DB;
  const p = clamp(Math.round(position), 0, SLIDER_STEPS);
  if (p === 0) return SILENT_DB;
  return Math.round((minDb + (p / SLIDER_STEPS) * (maxDb - minDb)) * 10) / 10;
}

/** "−∞ dB", "0.0 dB", "+3.5 dB", "−12.0 dB" (unicode minus). */
export function formatDb(db: number): string {
  const d = clampDb(db);
  if (d === SILENT_DB) return "−∞ dB";
  const r = Math.round(d * 10) / 10;
  if (r === 0) return "0.0 dB";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)} dB`;
}

function isAvailable(kind: TrackKind, available: AvailableTracks | undefined): boolean {
  return available ? available[kind] : true;
}

/** True when any (available) recorded track is soloed. */
export function anySolo(settings: AudioSettings, available?: AvailableTracks | undefined): boolean {
  return TRACK_KINDS.some((k) => isAvailable(k, available) && settings.tracks[k].solo);
}

/**
 * Effective linear gain for a recorded track: mute-all and track mute win; if any
 * track is soloed, non-soloed tracks are silent; otherwise track × master gain.
 */
export function trackGain(
  settings: AudioSettings,
  kind: TrackKind,
  available?: AvailableTracks | undefined,
): number {
  if (!isAvailable(kind, available)) return 0;
  const track = settings.tracks[kind];
  if (settings.master.muteAll || track.muted) return 0;
  if (anySolo(settings, available) && !track.solo) return 0;
  return dbToGain(track.volumeDb) * dbToGain(settings.master.volumeDb);
}

/**
 * Effective linear gain for an extra region. Regions can't be soloed, so a solo on
 * any track silences them. `ducked` = voice currently active (sidechain envelope).
 */
export function regionGain(
  settings: AudioSettings,
  region: AudioRegion,
  opts?: { ducked?: boolean | undefined; available?: AvailableTracks | undefined } | undefined,
): number {
  if (settings.master.muteAll) return 0;
  if (anySolo(settings, opts?.available)) return 0;
  let gain = dbToGain(region.volumeDb) * dbToGain(settings.master.volumeDb);
  if (opts?.ducked && region.duck.enabled) gain *= dbToGain(-region.duck.amountDb);
  return gain;
}

function nonNegInt(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Clamp fades so each is ≥ 0 and fadeIn + fadeOut ≤ duration. `priority` keeps the
 * fade the user just edited and shrinks the other; without it both scale down.
 */
export function clampFades(
  fadeInMs: number,
  fadeOutMs: number,
  durationMs: number,
  priority?: "in" | "out" | undefined,
): { fadeInMs: number; fadeOutMs: number } {
  const d = Number.isFinite(durationMs) && durationMs > 0 ? Math.floor(durationMs) : 0;
  let fi = nonNegInt(fadeInMs);
  let fo = nonNegInt(fadeOutMs);
  if (fi + fo <= d) return { fadeInMs: fi, fadeOutMs: fo };
  if (priority === "in") {
    fi = Math.min(fi, d);
    fo = d - fi;
  } else if (priority === "out") {
    fo = Math.min(fo, d);
    fi = d - fo;
  } else {
    const scale = d / (fi + fo);
    fi = Math.floor(fi * scale);
    fo = Math.floor(fo * scale);
  }
  return { fadeInMs: fi, fadeOutMs: fo };
}

export function regionDurationMs(region: Pick<AudioRegion, "startMs" | "endMs">): number {
  return Math.max(0, region.endMs - region.startMs);
}

function fadePriority(patch: { fadeInMs?: number; fadeOutMs?: number }): "in" | "out" | undefined {
  if (patch.fadeInMs !== undefined) return "in";
  if (patch.fadeOutMs !== undefined) return "out";
  return undefined;
}

export type TrackPatch<K extends TrackKind> = Partial<AudioSettings["tracks"][K]>;

/** Patch one recorded track; clamps volume and fades (to `durationMs` or the fade cap). */
export function updateTrack<K extends TrackKind>(
  settings: AudioSettings,
  kind: K,
  patch: TrackPatch<K>,
  durationMs?: number | undefined,
): AudioSettings {
  const merged: AudioSettings["tracks"][K] = { ...settings.tracks[kind], ...patch };
  const limit = durationMs ?? AUDIO_LIMITS.fadeMaxMs * 2;
  const fades = clampFades(merged.fadeInMs, merged.fadeOutMs, limit, fadePriority(patch));
  const next: AudioSettings["tracks"][K] = {
    ...merged,
    volumeDb: clampDb(merged.volumeDb),
    fadeInMs: durationMs === undefined ? Math.min(fades.fadeInMs, AUDIO_LIMITS.fadeMaxMs) : fades.fadeInMs,
    fadeOutMs: durationMs === undefined ? Math.min(fades.fadeOutMs, AUDIO_LIMITS.fadeMaxMs) : fades.fadeOutMs,
  };
  return { ...settings, tracks: { ...settings.tracks, [kind]: next } as AudioSettings["tracks"] };
}

export function updateMaster(settings: AudioSettings, patch: Partial<MasterSettings>): AudioSettings {
  const master = { ...settings.master, ...patch };
  return { ...settings, master: { ...master, volumeDb: clampDb(master.volumeDb) } };
}

export function setClickVolume(settings: AudioSettings, volume: number): AudioSettings {
  const { min, max } = AUDIO_LIMITS.clickVolume;
  const v = Number.isFinite(volume) ? clamp(Math.round(volume), min, max) : settings.clickVolume;
  return { ...settings, clickVolume: v };
}

/** Add an extra audio region with defaults. Duplicate ids are ignored (returns input). */
export function addRegion(settings: AudioSettings, input: NewAudioRegion): AudioSettings {
  if (settings.regions.some((r) => r.id === input.id)) return settings;
  const startMs = nonNegInt(input.startMs);
  const endMs = Math.max(startMs, nonNegInt(input.endMs));
  const region: AudioRegion = {
    id: input.id,
    fileName: input.fileName,
    path: input.path,
    startMs,
    endMs,
    volumeDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    loop: false,
    duck: { ...DEFAULT_DUCK },
  };
  return { ...settings, regions: [...settings.regions, region] };
}

/** Remove a region by id. Unknown ids return the input unchanged. */
export function removeRegion(settings: AudioSettings, id: string): AudioSettings {
  if (!settings.regions.some((r) => r.id === id)) return settings;
  return { ...settings, regions: settings.regions.filter((r) => r.id !== id) };
}

export type RegionPatch = Partial<Omit<AudioRegion, "id" | "duck">> & { duck?: Partial<AudioRegion["duck"]> };

/** Patch a region; clamps volume, duck amount, and fades to the region duration. */
export function updateRegion(settings: AudioSettings, id: string, patch: RegionPatch): AudioSettings {
  const index = settings.regions.findIndex((r) => r.id === id);
  if (index < 0) return settings;
  const current = settings.regions[index] as AudioRegion;
  const { duck, ...rest } = patch;
  const merged: AudioRegion = { ...current, ...rest, duck: { ...current.duck, ...duck } };
  const { min, max } = AUDIO_LIMITS.duckAmountDb;
  const fades = clampFades(merged.fadeInMs, merged.fadeOutMs, regionDurationMs(merged), fadePriority(patch));
  const next: AudioRegion = {
    ...merged,
    volumeDb: clampDb(merged.volumeDb),
    ...fades,
    duck: {
      enabled: merged.duck.enabled,
      amountDb: Number.isFinite(merged.duck.amountDb) ? clamp(merged.duck.amountDb, min, max) : current.duck.amountDb,
    },
  };
  const regions = settings.regions.slice();
  regions[index] = next;
  return { ...settings, regions };
}

/** Reduce waveform peaks to at most `bars` values (max per bucket), clamped to [0, 1]. */
export function downsamplePeaks(peaks: readonly number[], bars: number): number[] {
  const n = Math.floor(bars);
  if (!(n > 0) || peaks.length === 0) return [];
  const clean = peaks.map((p) => (Number.isFinite(p) ? clamp(p, 0, 1) : 0));
  if (clean.length <= n) return clean;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * clean.length) / n);
    const end = Math.max(start + 1, Math.floor(((i + 1) * clean.length) / n));
    let m = 0;
    for (let j = start; j < end; j++) m = Math.max(m, clean[j] as number);
    out.push(m);
  }
  return out;
}
