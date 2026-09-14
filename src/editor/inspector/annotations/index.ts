export { AnnotationsInspector } from "./AnnotationsInspector";
export type { AnnotationsInspectorProps } from "./AnnotationsInspector";
export {
  DEFAULT_DURATION_MS,
  DUPLICATE_OFFSET,
  MIN_DURATION_MS,
  clampRange,
  createAnnotation,
  duplicateAnnotation,
  nextBadgeNumber,
  updateTiming,
} from "./annotations";
export type { CreateAnnotationOptions } from "./annotations";
export {
  CHORD_WINDOW_MS,
  KEYSTROKE_BADGE_MS,
  MOD,
  REPEAT_WINDOW_MS,
  detectKeystrokes,
  formatShortcut,
  isModifierCode,
  isTypingKey,
  keyGlyph,
  keystrokeBadgesFromCandidates,
  summarizeShortcuts,
} from "./keystrokes";
export type { KeyPlatform, KeyTelemetryEvent, KeystrokeCandidate, ShortcutSummary } from "./keystrokes";
export {
  ANNOTATION_KINDS,
  DEFAULT_BASE,
  DEFAULT_BASE_OVERRIDES,
  DEFAULT_PROPS,
  TEXT_FONTS,
  TOOL_GLYPHS,
  TOOL_LABELS,
} from "./types";
export type * from "./types";
