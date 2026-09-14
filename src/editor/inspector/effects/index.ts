export { EffectsInspector } from "./EffectsInspector";
export type { EffectsInspectorProps } from "./EffectsInspector";
export { RemoveSilenceDialog } from "./RemoveSilenceDialog";
export type { RemoveSilenceDialogProps } from "./RemoveSilenceDialog";
export {
  amplitudeToDb,
  clampRate,
  detectIdleSections,
  detectSilentGaps,
  formatMmSs,
  formatSilencePreview,
  maxRampMs,
  normalizeSpeedRegion,
  suggestIdleSpeedRegions,
  summarizeGaps,
  updateSpeedRegion,
} from "./logic";
export {
  DEFAULT_EFFECTS_SETTINGS,
  DEFAULT_IDLE_PARAMS,
  DEFAULT_SILENCE_PARAMS,
  DEFAULT_TITLE_CARD,
  EFFECTS_LIMITS,
  TRANSITION_KINDS,
  effectsSettingsSchema,
  titleCardSchema,
} from "./types";
export type {
  AudioEnvelope,
  CursorSample,
  EffectsSettings,
  IdleParams,
  SilenceParams,
  SilencePreview,
  SpeedRegionEdit,
  TimeRange,
  TitleCard,
  TransitionKind,
} from "./types";
