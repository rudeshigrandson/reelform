export {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  ProjectLoadError,
  formatIssuePath,
  issuesFromZod,
  loadProject,
  migrate,
} from "./migrations";
export type {
  Migration,
  MigrationResult,
  ProjectIssue,
  ProjectLoadErrorCode,
  RawDocument,
} from "./migrations";
export {
  CAPTURE_BACKENDS,
  SCHEMA_VERSION,
  captureInfoSchema,
  effectsDocSchema,
  exportConfigSchema,
  mediaSourceV1Schema,
  projectV1Schema,
  telemetryRefSchema,
  timelineV1Schema,
  uiStateSchema,
} from "./project";
export type {
  CaptureInfo,
  EffectsDoc,
  ExportConfigDoc,
  MediaSourceV1,
  ProjectV1,
  ProjectV1Input,
  TelemetryRef,
  TimelineV1,
  UiState,
} from "./project";
export {
  annotationSchema,
  audioRegionDocSchema,
  audioSettingsDocSchema,
  autoZoomSettingsSchema,
  cameraSettingsSchema,
  captionOptionsSchema,
  captionSchema,
  captionStyleSchema,
  rangeSchema,
  speedRegionDocSchema,
  transitionSchema,
  volumeDbSchema,
  zoomRegionSchema,
} from "./tabs";
export type {
  AnnotationDoc,
  AudioRegionDoc,
  AudioSettingsDoc,
  CaptionDoc,
  RangeDoc,
  SpeedRegionDoc,
  TransitionDoc,
  ZoomRegionDoc,
} from "./tabs";
