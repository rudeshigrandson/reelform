import { DEFAULT_MODEL_FOR_TIER, findModel } from "../../../../electron/captions/models";
import type { Caption, Word } from "../../captions";
import type { InspectorMessageKey } from "../i18n";

/**
 * Captions inspector types (design guide S18, ENGINEERING_SPEC §9.6).
 * Caption rows reuse the segmentation engine's `Caption` / `Word` shapes.
 */

export type { Caption, Word };

export type CaptionPreset = "clean" | "bold" | "karaoke" | "outline" | "pill";

export type CaptionPosition = "bottom" | "top" | "custom";

/** A font file copied into the project and registered as `family` (§9.6). */
export interface CustomFont {
  family: string;
  /** Original file name, for display. */
  fileName: string;
  /** Project-relative path (posix separators). */
  path: string;
}

export interface CaptionStyle {
  preset: CaptionPreset;
  font: string;
  /** Font size in px at 1080p output. */
  sizePx: number;
  /** Text color, #rrggbb. */
  color: string;
  /** Background pill color, #rrggbb. */
  bgColor: string;
  /** Background pill opacity, 0–100 (%). 0 = no pill. */
  bgOpacity: number;
  position: CaptionPosition;
  /** Vertical center when `position === "custom"`, 0–100 (% of frame height). */
  customY: number;
  maxLines: number;
  /** Karaoke: swap the current word's color using word timestamps. */
  wordHighlight: boolean;
  highlightColor: string;
  uppercase: boolean;
  /** Text stroke — only set by the "Outline" preset; no dedicated control. */
  outline: boolean;
  /** Fonts added with "Add custom font…", offered after the defaults. */
  customFonts: CustomFont[];
}

export type CaptionModel = "fast" | "balanced" | "accurate";

export interface CaptionModelInfo {
  id: CaptionModel;
  /** English name (non-UI callers); the inspector shows `labelKey`. */
  label: string;
  labelKey: InspectorMessageKey;
  /** Rounded display size. */
  size: string;
}

/** Display size of the whisper model a tier downloads (SPEC §9.6 catalog). */
function catalogSize(tier: CaptionModel): string {
  return findModel(DEFAULT_MODEL_FOR_TIER[tier])?.displaySize ?? "";
}

export const CAPTION_MODELS: readonly CaptionModelInfo[] = [
  {
    id: "fast",
    label: "Fast",
    labelKey: "inspector.captions.model.fast",
    size: catalogSize("fast"),
  },
  {
    id: "balanced",
    label: "Balanced",
    labelKey: "inspector.captions.model.balanced",
    size: catalogSize("balanced"),
  },
  {
    id: "accurate",
    label: "Accurate",
    labelKey: "inspector.captions.model.accurate",
    size: catalogSize("accurate"),
  },
];

export function modelInfo(model: CaptionModel): CaptionModelInfo {
  const found = CAPTION_MODELS.find((m) => m.id === model);
  // CAPTION_MODELS covers every CaptionModel member.
  return (
    found ?? {
      id: "balanced",
      label: "Balanced",
      labelKey: "inspector.captions.model.balanced",
      size: catalogSize("balanced"),
    }
  );
}

export interface CaptionLanguage {
  /** Whisper language code, or "auto". */
  code: string;
  /** Display name; used as-is when `labelKey` is absent (host-supplied languages). */
  label: string;
  labelKey?: InspectorMessageKey | undefined;
}

export const CAPTION_LANGUAGES: readonly CaptionLanguage[] = [
  { code: "auto", label: "Auto-detect", labelKey: "inspector.captions.lang.auto" },
  { code: "en", label: "English", labelKey: "inspector.captions.lang.en" },
  { code: "es", label: "Spanish", labelKey: "inspector.captions.lang.es" },
  { code: "fr", label: "French", labelKey: "inspector.captions.lang.fr" },
  { code: "de", label: "German", labelKey: "inspector.captions.lang.de" },
  { code: "it", label: "Italian", labelKey: "inspector.captions.lang.it" },
  { code: "pt", label: "Portuguese", labelKey: "inspector.captions.lang.pt" },
  { code: "nl", label: "Dutch", labelKey: "inspector.captions.lang.nl" },
  { code: "ja", label: "Japanese", labelKey: "inspector.captions.lang.ja" },
  { code: "ko", label: "Korean", labelKey: "inspector.captions.lang.ko" },
  { code: "zh", label: "Chinese", labelKey: "inspector.captions.lang.zh" },
  { code: "hi", label: "Hindi", labelKey: "inspector.captions.lang.hi" },
];

export type GenerationStatus =
  | { kind: "idle" }
  | { kind: "downloading" /** 0–1 */; progress: number }
  | { kind: "transcribing" /** 0–1 */; progress: number; doneMs: number; totalMs: number }
  | { kind: "error"; message: string };

export const IDLE_STATUS: GenerationStatus = { kind: "idle" };

export const DEFAULT_CAPTION_FONTS: readonly string[] = [
  "Inter",
  "SF Pro",
  "Helvetica Neue",
  "Arial",
  "Georgia",
];

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  preset: "clean",
  font: "Inter",
  sizePx: 40,
  color: "#ffffff",
  bgColor: "#000000",
  bgOpacity: 0,
  position: "bottom",
  customY: 85,
  maxLines: 2,
  wordHighlight: false,
  highlightColor: "#ffd60a",
  uppercase: false,
  outline: false,
  customFonts: [],
};

/** Fields a preset overrides; font, size, position and max lines are kept. */
export type PresetFields = Pick<
  CaptionStyle,
  "color" | "bgColor" | "bgOpacity" | "wordHighlight" | "highlightColor" | "uppercase" | "outline"
>;

export interface CaptionPresetInfo {
  id: CaptionPreset;
  /** English name (non-UI callers); the inspector shows `labelKey`. */
  label: string;
  labelKey: InspectorMessageKey;
  fields: PresetFields;
}

export const CAPTION_PRESETS: readonly CaptionPresetInfo[] = [
  {
    id: "clean",
    label: "Clean",
    labelKey: "inspector.captions.preset.clean",
    fields: {
      color: "#ffffff",
      bgColor: "#000000",
      bgOpacity: 0,
      wordHighlight: false,
      highlightColor: "#ffd60a",
      uppercase: false,
      outline: false,
    },
  },
  {
    id: "bold",
    label: "Bold",
    labelKey: "inspector.captions.preset.bold",
    fields: {
      color: "#ffffff",
      bgColor: "#000000",
      bgOpacity: 0,
      wordHighlight: false,
      highlightColor: "#ffd60a",
      uppercase: true,
      outline: false,
    },
  },
  {
    id: "karaoke",
    label: "Karaoke",
    labelKey: "inspector.captions.preset.karaoke",
    fields: {
      color: "#ffffff",
      bgColor: "#000000",
      bgOpacity: 40,
      wordHighlight: true,
      highlightColor: "#ffd60a",
      uppercase: false,
      outline: false,
    },
  },
  {
    id: "outline",
    label: "Outline",
    labelKey: "inspector.captions.preset.outline",
    fields: {
      color: "#ffffff",
      bgColor: "#000000",
      bgOpacity: 0,
      wordHighlight: false,
      highlightColor: "#ffd60a",
      uppercase: false,
      outline: true,
    },
  },
  {
    id: "pill",
    label: "Pill",
    labelKey: "inspector.captions.preset.pill",
    fields: {
      color: "#ffffff",
      bgColor: "#000000",
      bgOpacity: 70,
      wordHighlight: false,
      highlightColor: "#ffd60a",
      uppercase: false,
      outline: false,
    },
  },
];

export function applyPreset(style: CaptionStyle, preset: CaptionPreset): CaptionStyle {
  const info = CAPTION_PRESETS.find((p) => p.id === preset);
  if (!info) return style;
  return { ...style, ...info.fields, preset };
}
