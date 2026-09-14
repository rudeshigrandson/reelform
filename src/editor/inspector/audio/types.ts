/**
 * Audio inspector settings (design guide S17, engineering spec §9.5).
 *
 * Volumes are stored in dB. Silence is `-Infinity` (shown as "−∞ dB"); anything at or
 * below `AUDIO_LIMITS.minDb` is normalized to silence. Note: `-Infinity` is not
 * JSON-safe — the project serializer must encode it (e.g. as `null`) on save.
 */

export type TrackKind = "mic" | "system";

export const TRACK_KINDS: readonly TrackKind[] = ["mic", "system"] as const;

export const TRACK_LABELS: Readonly<Record<TrackKind, string>> = {
  mic: "Microphone",
  system: "System audio",
};

export const AUDIO_LIMITS = {
  /** Slider floor; values ≤ this are treated as silent (−∞). */
  minDb: -60,
  maxDb: 12,
  /** Cap for a track fade when the track duration is unknown. */
  fadeMaxMs: 10_000,
  duckAmountDb: { min: 0, max: 30 },
  /** Mirrors S14 cursor click-sound volume (percent). */
  clickVolume: { min: 0, max: 100 },
} as const;

export const SILENT_DB = Number.NEGATIVE_INFINITY;

export interface TrackSettings {
  volumeDb: number;
  muted: boolean;
  solo: boolean;
  /** Loudness-normalize to −16 LUFS. */
  normalize: boolean;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface MicTrackSettings extends TrackSettings {
  /** RNNoise on the mic track. */
  noiseReduction: boolean;
}

export interface DuckSettings {
  enabled: boolean;
  /** Gain reduction applied while voice is active, in dB (positive number). */
  amountDb: number;
}

/** Extra audio (music / voiceover) placed on the timeline. */
export interface AudioRegion {
  id: string;
  fileName: string;
  path: string;
  startMs: number;
  endMs: number;
  volumeDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  loop: boolean;
  duck: DuckSettings;
}

export interface MasterSettings {
  volumeDb: number;
  muteAll: boolean;
}

export interface AudioSettings {
  tracks: { mic: MicTrackSettings; system: TrackSettings };
  regions: AudioRegion[];
  master: MasterSettings;
  /** Cursor click sound volume, 0–100 (mirrors S14). */
  clickVolume: number;
}

export interface AvailableTracks {
  mic: boolean;
  system: boolean;
}

/** Fields required to add an extra audio region; the rest take defaults. */
export interface NewAudioRegion {
  id: string;
  fileName: string;
  path: string;
  startMs: number;
  endMs: number;
}

export const DEFAULT_TRACK: TrackSettings = {
  volumeDb: 0,
  muted: false,
  solo: false,
  normalize: false,
  fadeInMs: 0,
  fadeOutMs: 0,
};

export const DEFAULT_DUCK: DuckSettings = { enabled: true, amountDb: 12 };

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  tracks: {
    mic: { ...DEFAULT_TRACK, noiseReduction: false },
    system: { ...DEFAULT_TRACK },
  },
  regions: [],
  master: { volumeDb: 0, muteAll: false },
  clickVolume: 60,
};
