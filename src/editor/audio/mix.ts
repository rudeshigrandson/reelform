import type { AudioSettings, AvailableTracks, TrackKind } from "../inspector/audio/types";
import { dbToLinear } from "./dsp";

/**
 * Mute / solo semantics for the audio graph (ENGINEERING_SPEC §9.5, design S17).
 * Gains here exclude the master gain — master is its own node in the graph.
 */

export interface Audibility {
  mic: boolean;
  system: boolean;
  /** Extra regions and click sounds: not soloable, so any solo silences them. */
  extras: boolean;
}

/** Which buses are audible. Mute-all and track mute win; any solo mutes non-solo. */
export function audibility(
  settings: AudioSettings,
  available: AvailableTracks = { mic: true, system: true },
): Audibility {
  if (settings.master.muteAll) return { mic: false, system: false, extras: false };
  const solo = (k: TrackKind) => available[k] && settings.tracks[k].solo;
  const anySolo = solo("mic") || solo("system");
  const track = (k: TrackKind) =>
    available[k] && !settings.tracks[k].muted && (!anySolo || settings.tracks[k].solo);
  return { mic: track("mic"), system: track("system"), extras: !anySolo };
}

/** Static linear bus gain for a recorded track (volume × audibility). */
export function trackBusGain(
  settings: AudioSettings,
  kind: TrackKind,
  available?: AvailableTracks | undefined,
): number {
  return audibility(settings, available)[kind] ? dbToLinear(settings.tracks[kind].volumeDb) : 0;
}

/** Master linear gain (0 when muted all). */
export function masterGain(settings: AudioSettings): number {
  return settings.master.muteAll ? 0 : dbToLinear(settings.master.volumeDb);
}

/** Click-sound gain from the 0–100 volume, silenced by solo / mute-all. */
export function clickBusGain(
  settings: AudioSettings,
  available?: AvailableTracks | undefined,
): number {
  if (!audibility(settings, available).extras) return 0;
  const v = Number.isFinite(settings.clickVolume) ? settings.clickVolume : 0;
  return Math.min(100, Math.max(0, v)) / 100;
}
