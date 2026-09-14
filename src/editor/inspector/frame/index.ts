export { FrameInspector } from "./FrameInspector";
export type { FrameInspectorProps, FrameSectionId } from "./FrameInspector";
export {
  ASPECT_PRESETS,
  BACKGROUND_KINDS,
  BUILT_IN_FRAME_PRESETS,
  DEFAULT_FRAME_SETTINGS,
  FRAME_LIMITS,
  PLACEHOLDER_WALLPAPERS,
  WALLPAPER_CATEGORIES,
  frameSettingsSchema,
} from "./types";
export type {
  AspectPreset,
  BackgroundKind,
  FrameAspect,
  FrameBackground,
  FrameGradient,
  FramePadding,
  FramePreset,
  FrameSettings,
  GradientStop,
  Size,
  Wallpaper,
  WallpaperCategory,
} from "./types";
export {
  addGradientStop,
  applyPreset,
  aspectRatio,
  clampFrameSettings,
  findMatchingPreset,
  gradientToCss,
  matchesPreset,
  outputSize,
  removeGradientStop,
  resolvePadding,
  setPaddingAll,
  setPaddingMatchAll,
  setPaddingSide,
  updateGradientStop,
  validateCustomSize,
} from "./frameLogic";
export type { CustomSizeResult, PaddingSide } from "./frameLogic";
