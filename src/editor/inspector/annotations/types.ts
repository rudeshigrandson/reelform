import { type InspectorMessageKey, translatedRecord } from "../i18n";

/**
 * Annotation model (ENGINEERING_SPEC §9.7, design guide S19).
 *
 * Geometry (`x`, `y`, `w`, `h`) is normalized 0..1 relative to the output
 * frame; `rotation` is degrees. Times are timeline milliseconds.
 */

export const ANNOTATION_KINDS = [
  "text",
  "arrow",
  "line",
  "rect",
  "ellipse",
  "highlight",
  "blur",
  "image",
  "emoji",
  "numberBadge",
  "keystrokeBadge",
] as const;

export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** A toolbar tool creates the annotation kind of the same name. */
export type AnnotationTool = AnnotationKind;

export type AnimType = "none" | "fade" | "pop" | "slide";
export type SlideDirection = "left" | "right" | "up" | "down";

export interface AnnotationAnim {
  type: AnimType;
  /** Only meaningful when `type === "slide"`: the edge it slides from/to. */
  direction: SlideDirection;
  ms: number;
}

export interface AnnotationBase {
  id: string;
  startMs: number;
  endMs: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  /** When true the annotation moves with the camera (zoom/pan). */
  followZoom: boolean;
  animIn: AnnotationAnim;
  animOut: AnnotationAnim;
}

export type TextAlign = "left" | "center" | "right";
export type FontWeight = 400 | 500 | 700;
export const TEXT_FONTS = ["Inter", "System", "Mono", "Serif"] as const;
export type TextFont = (typeof TEXT_FONTS)[number];

export interface TextAnnotation extends AnnotationBase {
  kind: "text";
  text: string;
  font: TextFont;
  fontSize: number;
  fontWeight: FontWeight;
  color: string;
  /** Background pill behind the text. */
  background: boolean;
  backgroundColor: string;
  padding: number;
  align: TextAlign;
}

export type ArrowHeadStyle = "triangle" | "open" | "circle" | "none";

export interface ArrowAnnotation extends AnnotationBase {
  kind: "arrow";
  strokeWidth: number;
  color: string;
  headStyle: ArrowHeadStyle;
  dashed: boolean;
}

export interface LineAnnotation extends AnnotationBase {
  kind: "line";
  strokeWidth: number;
  color: string;
  dashed: boolean;
}

export interface ShapeProps {
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface RectAnnotation extends AnnotationBase, ShapeProps {
  kind: "rect";
  radius: number;
}

export interface EllipseAnnotation extends AnnotationBase, ShapeProps {
  kind: "ellipse";
}

/** Translucent marker. */
export interface HighlightAnnotation extends AnnotationBase {
  kind: "highlight";
  fill: string;
  radius: number;
}

export interface BlurAnnotation extends AnnotationBase {
  kind: "blur";
  strength: number;
  pixelate: boolean;
}

export type ImageFit = "contain" | "cover" | "fill";

export interface ImageAnnotation extends AnnotationBase {
  kind: "image";
  /** Project-relative asset path; empty until an image is dropped/picked. */
  src: string;
  fit: ImageFit;
  cornerRadius: number;
}

export interface EmojiAnnotation extends AnnotationBase {
  kind: "emoji";
  emoji: string;
}

export interface NumberBadgeAnnotation extends AnnotationBase {
  kind: "numberBadge";
  value: number;
  fill: string;
  color: string;
}

export interface KeystrokeBadgeAnnotation extends AnnotationBase {
  kind: "keystrokeBadge";
  /** Formatted shortcut label, e.g. "⌘K". */
  label: string;
}

export type Annotation =
  | TextAnnotation
  | ArrowAnnotation
  | LineAnnotation
  | RectAnnotation
  | EllipseAnnotation
  | HighlightAnnotation
  | BlurAnnotation
  | ImageAnnotation
  | EmojiAnnotation
  | NumberBadgeAnnotation
  | KeystrokeBadgeAnnotation;

export type AnnotationOf<K extends AnnotationKind> = Extract<Annotation, { kind: K }>;

/** Per-kind properties, without the common base fields. */
export type AnnotationProps<K extends AnnotationKind> = Omit<AnnotationOf<K>, keyof AnnotationBase>;

export const TOOL_LABEL_KEYS: Readonly<Record<AnnotationTool, InspectorMessageKey>> = {
  text: "inspector.annotations.tool.text",
  arrow: "inspector.annotations.tool.arrow",
  line: "inspector.annotations.tool.line",
  rect: "inspector.annotations.tool.rect",
  ellipse: "inspector.annotations.tool.ellipse",
  highlight: "inspector.annotations.tool.highlight",
  blur: "inspector.annotations.tool.blur",
  image: "inspector.annotations.tool.image",
  emoji: "inspector.annotations.tool.emoji",
  numberBadge: "inspector.annotations.tool.numberBadge",
  keystrokeBadge: "inspector.annotations.tool.keystrokeBadge",
};

/** Tool names in the active window language (non-React callers, e.g. timeline item labels). */
export const TOOL_LABELS: Readonly<Record<AnnotationTool, string>> =
  translatedRecord(TOOL_LABEL_KEYS);

/** Display names of the bundled text fonts (the stored value stays the id). */
export const TEXT_FONT_LABEL_KEYS: Readonly<Record<TextFont, InspectorMessageKey>> = {
  Inter: "inspector.annotations.font.inter",
  System: "inspector.annotations.font.system",
  Mono: "inspector.annotations.font.mono",
  Serif: "inspector.annotations.font.serif",
};

export const TOOL_GLYPHS: Readonly<Record<AnnotationTool, string>> = {
  text: "T",
  arrow: "↗",
  line: "╱",
  rect: "▭",
  ellipse: "◯",
  highlight: "▬",
  blur: "▦",
  image: "▣",
  emoji: "☺",
  numberBadge: "①",
  keystrokeBadge: "⌘",
};

const DEFAULT_ANIM_IN: AnnotationAnim = { type: "fade", direction: "up", ms: 200 };
const DEFAULT_ANIM_OUT: AnnotationAnim = { type: "fade", direction: "down", ms: 200 };

export const DEFAULT_BASE: Readonly<Omit<AnnotationBase, "id" | "startMs" | "endMs">> = {
  x: 0.4,
  y: 0.4,
  w: 0.2,
  h: 0.1,
  rotation: 0,
  opacity: 1,
  followZoom: true,
  animIn: DEFAULT_ANIM_IN,
  animOut: DEFAULT_ANIM_OUT,
};

/** Default per-kind properties plus a default size for newly created items. */
export const DEFAULT_PROPS: { readonly [K in AnnotationKind]: AnnotationProps<K> } = {
  text: {
    kind: "text",
    text: "Text",
    font: "Inter",
    fontSize: 32,
    fontWeight: 700,
    color: "#ffffff",
    background: true,
    backgroundColor: "#111111",
    padding: 12,
    align: "center",
  },
  arrow: { kind: "arrow", strokeWidth: 6, color: "#ff5a5f", headStyle: "triangle", dashed: false },
  line: { kind: "line", strokeWidth: 4, color: "#ff5a5f", dashed: false },
  rect: { kind: "rect", fill: "#00000000", stroke: "#ff5a5f", strokeWidth: 4, radius: 8 },
  ellipse: { kind: "ellipse", fill: "#00000000", stroke: "#ff5a5f", strokeWidth: 4 },
  highlight: { kind: "highlight", fill: "#ffe14d", radius: 4 },
  blur: { kind: "blur", strength: 16, pixelate: false },
  image: { kind: "image", src: "", fit: "contain", cornerRadius: 0 },
  emoji: { kind: "emoji", emoji: "👉" },
  numberBadge: { kind: "numberBadge", value: 1, fill: "#ff5a5f", color: "#ffffff" },
  keystrokeBadge: { kind: "keystrokeBadge", label: "" },
};

/** Base overrides applied on creation for specific kinds. */
export const DEFAULT_BASE_OVERRIDES: { readonly [K in AnnotationKind]?: Partial<AnnotationBase> } =
  {
    highlight: { opacity: 0.35, h: 0.05 },
    arrow: { h: 0.15 },
    line: { h: 0.01 },
    emoji: { w: 0.06, h: 0.1 },
    numberBadge: { w: 0.05, h: 0.08, animIn: { type: "pop", direction: "up", ms: 200 } },
    keystrokeBadge: { w: 0.12, h: 0.06, x: 0.44, y: 0.85, followZoom: false },
  };
