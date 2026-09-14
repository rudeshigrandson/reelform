import type { Caption, Word } from "../../captions";

/**
 * Captions inspector types (design guide S18, ENGINEERING_SPEC §9.6).
 * Caption rows reuse the segmentation engine's `Caption` / `Word` shapes.
 */

export type { Caption, Word };

export type CaptionPreset = "clean" | "bold" | "karaoke" | "outline" | "pill";

export type CaptionPosition = "bottom" | "top" | "custom";

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
}

export type CaptionModel = "fast" | "balanced" | "accurate";

export interface CaptionModelInfo {
  id: CaptionModel;
  label: string;
  /** Rounded display size. */
  size: string;
}

export const CAPTION_MODELS: readonly CaptionModelInfo[] = [
  { id: "fast", label: "Fast", size: "75 MB" },
  { id: "balanced", label: "Balanced", size: "466 MB" },
  { id: "accurate", label: "Accurate", size: "1.5 GB" },
];

export function modelInfo(model: CaptionModel): CaptionModelInfo {
  const found = CAPTION_MODELS.find((m) => m.id === model);
  // CAPTION_MODELS covers every CaptionModel member.
  return found ?? { id: "balanced", label: "Balanced", size: "466 MB" };
}

export interface CaptionLanguage {
  /** Whisper language code, or "auto". */
  code: string;
  label: string;
}

export const CAPTION_LANGUAGES: readonly CaptionLanguage[] = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "hi", label: "Hindi" },
];

export type GenerationStatus =
  | { kind: "idle" }
  | { kind: "downloading"; /** 0–1 */ progress: number }
  | { kind: "transcribing"; /** 0–1 */ progress: number; doneMs: number; totalMs: number }
  | { kind: "error"; message: string };

export const IDLE_STATUS: GenerationStatus = { kind: "idle" };

export const DEFAULT_CAPTION_FONTS: readonly string[] = ["Inter", "SF Pro", "Helvetica Neue", "Arial", "Georgia"];

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
};

/** Fields a preset overrides; font, size, position and max lines are kept. */
export type PresetFields = Pick<
  CaptionStyle,
  "color" | "bgColor" | "bgOpacity" | "wordHighlight" | "highlightColor" | "uppercase" | "outline"
>;

export interface CaptionPresetInfo {
  id: CaptionPreset;
  label: string;
  fields: PresetFields;
}

export const CAPTION_PRESETS: readonly CaptionPresetInfo[] = [
  {
    id: "clean",
    label: "Clean",
    fields: { color: "#ffffff", bgColor: "#000000", bgOpacity: 0, wordHighlight: false, highlightColor: "#ffd60a", uppercase: false, outline: false },
  },
  {
    id: "bold",
    label: "Bold",
    fields: { color: "#ffffff", bgColor: "#000000", bgOpacity: 0, wordHighlight: false, highlightColor: "#ffd60a", uppercase: true, outline: false },
  },
  {
    id: "karaoke",
    label: "Karaoke",
    fields: { color: "#ffffff", bgColor: "#000000", bgOpacity: 40, wordHighlight: true, highlightColor: "#ffd60a", uppercase: false, outline: false },
  },
  {
    id: "outline",
    label: "Outline",
    fields: { color: "#ffffff", bgColor: "#000000", bgOpacity: 0, wordHighlight: false, highlightColor: "#ffd60a", uppercase: false, outline: true },
  },
  {
    id: "pill",
    label: "Pill",
    fields: { color: "#ffffff", bgColor: "#000000", bgOpacity: 70, wordHighlight: false, highlightColor: "#ffd60a", uppercase: false, outline: false },
  },
];

export function applyPreset(style: CaptionStyle, preset: CaptionPreset): CaptionStyle {
  const info = CAPTION_PRESETS.find((p) => p.id === preset);
  if (!info) return style;
  return { ...style, ...info.fields, preset };
}
