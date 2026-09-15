/** Inspector host: ports + the logic behind every host action (guide S13–S21). */

export type {
  CaptionModelStatus,
  CaptionsPort,
  CaptionsProgressEvent,
  DecodedAudio,
  EditorPatch,
  FileFilter,
  ImportKind,
  ImportedMedia,
  InspectorHost,
  IpcImportKind,
  MetaUpdateEffects,
  PickFileOptions,
  RelinkRequest,
  RelinkResult,
  SaveFileOptions,
  TranscribeRange,
  TranscribedCaption,
  TrimSourceResult,
} from "./types";
export {
  HostUnavailableError,
  createDefaultInspectorHost,
  detectPlatform,
  noopCaptionsPort,
} from "./defaultHost";
export {
  type InspectorSelection,
  type InspectorSelectionKind,
  inspectorTabForSelection,
  nextInspectorTab,
  selectionFromEditor,
} from "./inspectorTab";
export {
  type MappedRange,
  type SpeedLike,
  clipsEndMs,
  deriveTranscribeRanges,
  effectiveClips,
  rangeOutputMs,
  removeSourceRanges,
  sourceRangesToTimeline,
  sourceToTimelineMs,
  timelineClips,
  toIpcRanges,
  wavToTimelineMs,
} from "./timeMap";
export {
  type GenerateInput,
  type ReviewState,
  generateSuggestions,
  mergeZoomSuggestions,
  reviewDone,
  reviewStep,
  startReview,
  suggestionsToTimeline,
  suggestionsToastText,
} from "./zoomSuggestions";
export {
  type AudioCandidate,
  NO_AUDIO_MESSAGE,
  NO_SPEECH_MESSAGE,
  captionsErrorMessage,
  mapTranscribedCaptions,
  modelIdForTier,
  pickAudioCandidate,
  sidecarFileName,
  statusFromProgress,
} from "./captionsFlow";
export {
  SYNC_ENVELOPE_HZ,
  SYNC_WINDOW_MS,
  type SyncResult,
  bestLag,
  energyEnvelope,
  estimateSyncOffsetMs,
  toMono,
} from "./webcamSync";
export {
  type SyncWorkerFactory,
  type SyncWorkerLike,
  estimateSyncOffsetOffThread,
} from "./webcamSyncRunner";
export {
  REC_MOD,
  cursorSamplesFromTelemetry,
  detectTelemetryShortcuts,
  recorderModsToMod,
  telemetryKeysToEvents,
  uiohookToDomCode,
} from "./telemetryInputs";
export {
  CAPTURE_BACKEND_LABELS,
  absoluteSourcePath,
  projectInfoFromSession,
  roleForPath,
  sourcePaths,
} from "./projectInfo";
export { fileNameOf, peaksFromAudio } from "./audioPeaks";
export {
  type SilenceCutResult,
  applySilenceCuts,
  nonOverlappingRegions,
  silenceSourceUrl,
} from "./EffectsTab";
export { availableTracksFor, regionUrl } from "./AudioTab";
export { webcamSourceFor, withWebcamSource, withoutWebcamSource } from "./WebcamTab";
export { trimHistoryEffects, withSourcePath, withTrimmedSource } from "./ProjectTab";
export { ipcImportKind } from "./types";
export {
  FrameTab,
  type FrameTabProps,
  IMAGE_FILTERS,
  USER_PRESETS_SETTINGS_KEY,
  loadWallpaperCatalogue,
  readUserPresets,
  wallpapersFromPack,
} from "./FrameTab";
export { CURSOR_FILTERS, CursorTab } from "./CursorTab";
export { FONT_FILTERS } from "./CaptionsTab";
export { fileSystemPath, pathForFile } from "./filePaths";
