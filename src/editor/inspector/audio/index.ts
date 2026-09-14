export { AudioInspector, WAVEFORM_BARS } from "./AudioInspector";
export type { AudioInspectorProps } from "./AudioInspector";
export {
  SLIDER_STEPS,
  addRegion,
  anySolo,
  clampDb,
  clampFades,
  dbToGain,
  dbToSliderPosition,
  downsamplePeaks,
  formatDb,
  gainToDb,
  regionDurationMs,
  regionGain,
  removeRegion,
  setClickVolume,
  sliderPositionToDb,
  trackGain,
  updateMaster,
  updateRegion,
  updateTrack,
} from "./audio";
export type { RegionPatch, TrackPatch } from "./audio";
export {
  AUDIO_LIMITS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_DUCK,
  DEFAULT_TRACK,
  SILENT_DB,
  TRACK_KINDS,
  TRACK_LABELS,
} from "./types";
export type {
  AudioRegion,
  AudioSettings,
  AvailableTracks,
  DuckSettings,
  MasterSettings,
  MicTrackSettings,
  NewAudioRegion,
  TrackKind,
  TrackSettings,
} from "./types";
