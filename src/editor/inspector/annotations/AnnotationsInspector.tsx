import { Button } from "@design/components";
import { type CSSProperties, type ReactElement, type ReactNode, useId } from "react";
import {
  Callout,
  type ChoiceOption,
  ChoiceRow,
  ColorField,
  EmptyState,
  FieldRow,
  GroupLabel,
  NumberField,
  Slider,
  Switch,
  Toggle,
  clamp,
  hintStyle,
  inspectorRootStyle,
  monoStyle,
  useInspectorControlStyles,
  valueBoxStyle,
} from "../controls";
import { type InspectorMessageKey, type InspectorTranslate, useInspectorT } from "../i18n";
import { updateTiming } from "./annotations";
import { type KeystrokeCandidate, summarizeShortcuts } from "./keystrokes";
import {
  ANNOTATION_KINDS,
  type AnimType,
  type Annotation,
  type AnnotationAnim,
  type AnnotationOf,
  type AnnotationTool,
  type ArrowHeadStyle,
  type FontWeight,
  type ImageFit,
  type SlideDirection,
  TEXT_FONTS,
  TEXT_FONT_LABEL_KEYS,
  TOOL_GLYPHS,
  TOOL_LABEL_KEYS,
  type TextAlign,
  type TextFont,
} from "./types";

export interface AnnotationsInspectorProps {
  /** Currently armed canvas tool; `null` = pointer/selection. */
  activeTool: AnnotationTool | null;
  onToolChange: (tool: AnnotationTool | null) => void;
  selected: Annotation | null;
  onChange: (annotation: Annotation) => void;
  onDuplicate: (annotation: Annotation) => void;
  onDelete: (annotation: Annotation) => void;
  /** Shortcut candidates from key telemetry (see `detectKeystrokes`). */
  detectedShortcuts: readonly KeystrokeCandidate[];
  onAddAllShortcuts: () => void;
  /** Used to clamp timing edits; defaults to unbounded. */
  timelineDurationMs?: number | undefined;
  /** "Choose image…" for image annotations; hidden when absent. */
  onPickImage?: ((annotation: AnnotationOf<"image">) => void) | undefined;
  /** Inline error from the last image pick/import. */
  imageError?: string | null | undefined;
}

const toolbarStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
  gap: "6px",
};

function toolButtonStyle(active: boolean): CSSProperties {
  return {
    appearance: "none",
    height: "34px",
    padding: 0,
    borderRadius: "8px",
    border: 0,
    background: active ? "var(--accent)" : "var(--bg-panel-raised)",
    color: active ? "var(--on-accent)" : "var(--text-1)",
    fontFamily: "var(--font-body)",
    fontSize: "13px",
    fontWeight: active ? 700 : 400,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  };
}

const groupStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "9px" };

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  minWidth: 0,
};

const rowLabelStyle: CSSProperties = { flex: "0 0 60px", color: "var(--text-2)" };

/** Sunken text field / select (design: 8–10px radius, border-strong). */
const sunkenFieldStyle: CSSProperties = {
  ...valueBoxStyle,
  fontFamily: "var(--font-body)",
  width: "100%",
  outline: "none",
};

const pillButtonBase: CSSProperties = {
  flex: "1 1 0",
  padding: "8px",
  borderRadius: "999px",
  fontFamily: "var(--font-body)",
  fontSize: "12px",
  textAlign: "center",
  cursor: "pointer",
};

type OptionKeys<T> = ReadonlyArray<{ value: T; labelKey: InspectorMessageKey }>;

/** Localised tile options; the accessible name mirrors the visible label. */
const localize = <T extends string | number>(
  t: InspectorTranslate,
  list: OptionKeys<T>,
): ReadonlyArray<ChoiceOption<T>> =>
  list.map((o) => {
    const label = t(o.labelKey);
    return { value: o.value, label, ariaLabel: label };
  });

const ANIM_OPTIONS: OptionKeys<AnimType> = [
  { value: "none", labelKey: "inspector.common.none" },
  { value: "pop", labelKey: "inspector.annotations.anim.pop" },
  { value: "fade", labelKey: "inspector.annotations.anim.fade" },
  { value: "slide", labelKey: "inspector.annotations.anim.slide" },
];

const DIRECTION_OPTIONS: ReadonlyArray<ChoiceOption<SlideDirection>> = [
  { value: "left", label: "◂", ariaLabel: "◂" },
  { value: "right", label: "▸", ariaLabel: "▸" },
  { value: "up", label: "▴", ariaLabel: "▴" },
  { value: "down", label: "▾", ariaLabel: "▾" },
];

const WEIGHT_OPTIONS: OptionKeys<FontWeight> = [
  { value: 400, labelKey: "inspector.annotations.weight.regular" },
  { value: 500, labelKey: "inspector.annotations.weight.medium" },
  { value: 700, labelKey: "inspector.annotations.weight.bold" },
];

const ALIGN_OPTIONS: OptionKeys<TextAlign> = [
  { value: "left", labelKey: "inspector.annotations.align.left" },
  { value: "center", labelKey: "inspector.annotations.align.center" },
  { value: "right", labelKey: "inspector.annotations.align.right" },
];

const HEAD_OPTIONS: OptionKeys<ArrowHeadStyle> = [
  { value: "triangle", labelKey: "inspector.annotations.head.solid" },
  { value: "open", labelKey: "inspector.annotations.head.open" },
  { value: "circle", labelKey: "inspector.annotations.head.dot" },
  { value: "none", labelKey: "inspector.common.none" },
];

const FIT_OPTIONS: OptionKeys<ImageFit> = [
  { value: "contain", labelKey: "inspector.annotations.fit.contain" },
  { value: "cover", labelKey: "inspector.annotations.fit.cover" },
  { value: "fill", labelKey: "inspector.common.fill" },
];

/** Per-direction labels for the In / Out animation groups. */
const ANIM_LABEL_KEYS = {
  in: {
    label: "inspector.annotations.anim.in",
    group: "inspector.annotations.anim.inGroup",
    duration: "inspector.annotations.anim.inDuration",
  },
  out: {
    label: "inspector.annotations.anim.out",
    group: "inspector.annotations.anim.outGroup",
    duration: "inspector.annotations.anim.outDuration",
  },
} as const satisfies Record<string, Record<string, InspectorMessageKey>>;

/** Accessible name of each kind's property group. */
const KIND_GROUP_KEYS: Readonly<Record<Annotation["kind"], InspectorMessageKey>> = {
  text: "inspector.common.text",
  arrow: "inspector.annotations.stroke",
  line: "inspector.annotations.stroke",
  rect: "inspector.annotations.shape",
  ellipse: "inspector.annotations.shape",
  highlight: "inspector.common.highlight",
  blur: "inspector.common.blur",
  image: "inspector.common.image",
  emoji: "inspector.annotations.emoji",
  numberBadge: "inspector.annotations.badge",
  keystrokeBadge: "inspector.annotations.keystroke",
};

/** 60px label + control row (design "Animate  Pop Fade Slide"). */
function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div style={rowStyle}>
      <span style={rowLabelStyle}>{label}</span>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** Sunken single-line text input with an accessible name. */
function TextField({
  label,
  value,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  maxLength?: number | undefined;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <input
      type="text"
      className="rf-valuebox"
      aria-label={label}
      placeholder={label}
      value={value}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...sunkenFieldStyle, padding: "7px 10px", borderRadius: "10px", fontSize: "13px" }}
    />
  );
}

/** 22px colour swatch over a native picker (design: 6px radius). Colour is data. */
function Swatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <span
      title={label}
      style={{
        position: "relative",
        flex: "0 0 auto",
        width: "22px",
        height: "22px",
        boxSizing: "border-box",
        borderRadius: "6px",
        border: "1px solid var(--border-strong)",
        background: value,
      }}
    >
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          border: 0,
          padding: 0,
          cursor: "pointer",
        }}
      />
    </span>
  );
}

const pct = (n: number): number => Math.round(n * 1000) / 10;
const secs = (ms: number): number => Math.round(ms) / 1000;

/** Annotate tab (design guide S19). Presentational; all state via props. */
export function AnnotationsInspector(props: AnnotationsInspectorProps): ReactElement {
  useInspectorControlStyles();
  const t = useInspectorT();
  const { activeTool, onToolChange, selected } = props;
  return (
    <div style={inspectorRootStyle} aria-label={t("inspector.annotations.label")}>
      <div role="toolbar" aria-label={t("inspector.annotations.tools")} style={toolbarStyle}>
        {ANNOTATION_KINDS.map((tool) => {
          const active = activeTool === tool;
          return (
            <button
              key={tool}
              type="button"
              className="rf-choice"
              title={t(TOOL_LABEL_KEYS[tool])}
              aria-label={t(TOOL_LABEL_KEYS[tool])}
              aria-pressed={active}
              onClick={() => onToolChange(active ? null : tool)}
              style={toolButtonStyle(active)}
            >
              {TOOL_GLYPHS[tool]}
            </button>
          );
        })}
      </div>
      {selected ? <SelectedPanels {...props} selected={selected} /> : <NoSelection {...props} />}
    </div>
  );
}

function NoSelection({
  activeTool,
  detectedShortcuts,
  onAddAllShortcuts,
}: AnnotationsInspectorProps): ReactElement {
  const t = useInspectorT();
  const showKeystrokes = detectedShortcuts.length > 0 || activeTool === "keystrokeBadge";
  return (
    <>
      {activeTool && (
        <div style={hintStyle} role="status">
          {t("inspector.annotations.toolHint", { tool: t(TOOL_LABEL_KEYS[activeTool]) })}
        </div>
      )}
      {showKeystrokes && (
        <div role="group" aria-label={t("inspector.annotations.keystrokes")}>
          <KeystrokeList shortcuts={detectedShortcuts} onAddAll={onAddAllShortcuts} />
        </div>
      )}
      <EmptyState title={t("inspector.annotations.empty.title")} icon="✎">
        <ul
          style={{
            margin: 0,
            paddingLeft: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            textAlign: "left",
          }}
        >
          <li>{t("inspector.annotations.empty.tipTool")}</li>
          <li>{t("inspector.annotations.empty.tipPlayhead")}</li>
          <li>{t("inspector.annotations.empty.tipBadges")}</li>
          <li>{t("inspector.annotations.empty.tipSelect")}</li>
        </ul>
      </EmptyState>
    </>
  );
}

function KeystrokeList({
  shortcuts,
  onAddAll,
}: {
  shortcuts: readonly KeystrokeCandidate[];
  onAddAll: () => void;
}): ReactElement {
  const t = useInspectorT();
  const summary = summarizeShortcuts(shortcuts);
  const n = shortcuts.length;
  if (n === 0) {
    return (
      <Callout tone="neutral" role="note" title={t("inspector.annotations.noShortcuts.title")}>
        {t("inspector.annotations.noShortcuts.body")}
      </Callout>
    );
  }
  return (
    <Callout tone="success" style={{ padding: "10px", gap: "8px" }}>
      <div style={{ fontWeight: 700 }}>{t("inspector.annotations.detected", { count: n })}</div>
      <ul
        aria-label={t("inspector.annotations.detectedList")}
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
        }}
      >
        {summary.map((s) => (
          <li key={s.label} style={{ display: "flex", alignItems: "center", gap: "3px" }}>
            <kbd
              style={{
                ...monoStyle,
                fontSize: "10px",
                padding: "3px 7px",
                borderRadius: "4px",
                border: "1px solid var(--border-strong)",
                background: "transparent",
                color: "var(--text-1)",
              }}
            >
              {s.label}
            </kbd>
            <span style={{ ...monoStyle, fontSize: "10px", color: "var(--text-3)" }}>
              ×{s.count}
            </span>
          </li>
        ))}
      </ul>
      <Button
        variant="primary"
        onClick={onAddAll}
        style={{ width: "100%", padding: "7px 14px", fontSize: "12px", borderRadius: "999px" }}
      >
        {t("inspector.annotations.addAll")}
      </Button>
    </Callout>
  );
}

function SelectedPanels(props: AnnotationsInspectorProps & { selected: Annotation }): ReactElement {
  const t = useInspectorT();
  const {
    selected: a,
    onChange,
    onDuplicate,
    onDelete,
    timelineDurationMs = Number.POSITIVE_INFINITY,
  } = props;
  return (
    <>
      <div role="group" aria-label={t(KIND_GROUP_KEYS[a.kind])} style={groupStyle}>
        <GroupLabel>
          {t("inspector.annotations.selectedHeading", { kind: t(TOOL_LABEL_KEYS[a.kind]) })}
        </GroupLabel>
        <KindPanel
          a={a}
          onChange={onChange}
          onPickImage={props.onPickImage}
          imageError={props.imageError}
        />
      </div>

      <div style={groupStyle}>
        <GroupLabel>{t("inspector.annotations.animation")}</GroupLabel>
        <AnimControls
          direction="in"
          anim={a.animIn}
          onChange={(animIn) => onChange({ ...a, animIn })}
        />
        <AnimControls
          direction="out"
          anim={a.animOut}
          onChange={(animOut) => onChange({ ...a, animOut })}
        />
      </div>

      <div style={groupStyle}>
        <GroupLabel>{t("inspector.common.position")}</GroupLabel>
        <FieldRow>
          <NumberField
            inline
            label={t("inspector.common.x")}
            unit="%"
            step={0.5}
            min={0}
            max={100}
            value={pct(a.x)}
            onChange={(v) => onChange({ ...a, x: v / 100 })}
          />
          <NumberField
            inline
            label={t("inspector.common.y")}
            unit="%"
            step={0.5}
            min={0}
            max={100}
            value={pct(a.y)}
            onChange={(v) => onChange({ ...a, y: v / 100 })}
          />
          <NumberField
            inline
            label={t("inspector.annotations.rotation")}
            unit="°"
            min={-180}
            max={180}
            value={a.rotation}
            onChange={(rotation) => onChange({ ...a, rotation })}
          />
        </FieldRow>
        <FieldRow>
          <NumberField
            inline
            label={t("inspector.common.w")}
            unit="%"
            step={0.5}
            min={0.5}
            max={100}
            value={pct(a.w)}
            onChange={(v) => onChange({ ...a, w: v / 100 })}
          />
          <NumberField
            inline
            label={t("inspector.common.h")}
            unit="%"
            step={0.5}
            min={0.5}
            max={100}
            value={pct(a.h)}
            onChange={(v) => onChange({ ...a, h: v / 100 })}
          />
        </FieldRow>
        <Switch
          label={t("inspector.annotations.followZoom")}
          hint={t("inspector.annotations.followZoom.hint")}
          checked={a.followZoom}
          onChange={(followZoom) => onChange({ ...a, followZoom })}
        />
      </div>

      <div style={groupStyle}>
        <GroupLabel
          aside={
            <span style={{ ...monoStyle, color: "var(--text-3)" }}>
              {t("inspector.annotations.durationSeconds", { seconds: secs(a.endMs - a.startMs) })}
            </span>
          }
        >
          {t("inspector.common.timing")}
        </GroupLabel>
        <FieldRow>
          <NumberField
            inline
            label={t("inspector.common.start")}
            unit="s"
            step={0.1}
            min={0}
            value={secs(a.startMs)}
            onChange={(v) => onChange(updateTiming(a, { startMs: v * 1000 }, timelineDurationMs))}
          />
          <NumberField
            inline
            label={t("inspector.common.end")}
            unit="s"
            step={0.1}
            min={0}
            value={secs(a.endMs)}
            onChange={(v) => onChange(updateTiming(a, { endMs: v * 1000 }, timelineDurationMs))}
          />
        </FieldRow>
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          className="rf-choice"
          onClick={() => onDuplicate(a)}
          style={{
            ...pillButtonBase,
            appearance: "none",
            background: "var(--bg-panel-raised)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-1)",
          }}
        >
          {t("inspector.common.duplicate")}
        </button>
        <button
          type="button"
          className="rf-choice"
          onClick={() => onDelete(a)}
          style={{
            ...pillButtonBase,
            appearance: "none",
            background: "transparent",
            border: "1px solid transparent",
            color: "color-mix(in srgb, var(--record) 45%, var(--text-1))",
          }}
        >
          {t("inspector.common.delete")}
        </button>
      </div>
    </>
  );
}

function AnimControls({
  direction,
  anim,
  onChange,
}: {
  direction: keyof typeof ANIM_LABEL_KEYS;
  anim: AnnotationAnim;
  onChange: (anim: AnnotationAnim) => void;
}): ReactElement {
  const t = useInspectorT();
  const keys = ANIM_LABEL_KEYS[direction];
  return (
    <div role="group" aria-label={t(keys.group)} style={groupStyle}>
      <Row label={t(keys.label)}>
        <ChoiceRow
          label={t(keys.group)}
          value={anim.type}
          options={localize(t, ANIM_OPTIONS)}
          onChange={(type) => onChange({ ...anim, type })}
        />
      </Row>
      {anim.type === "slide" && (
        <Row label={t("inspector.annotations.anim.from")}>
          <ChoiceRow
            label={t("inspector.annotations.anim.from")}
            value={anim.direction}
            options={DIRECTION_OPTIONS}
            onChange={(direction) => onChange({ ...anim, direction })}
          />
        </Row>
      )}
      <Slider
        label={t(keys.duration)}
        labelWidth={60}
        unit="ms"
        min={0}
        max={1000}
        step={50}
        disabled={anim.type === "none"}
        value={anim.ms}
        onChange={(ms) => onChange({ ...anim, ms })}
      />
    </div>
  );
}

function KindPanel({
  a,
  onChange,
  onPickImage,
  imageError,
}: {
  a: Annotation;
  onChange: (a: Annotation) => void;
  onPickImage?: ((a: AnnotationOf<"image">) => void) | undefined;
  imageError?: string | null | undefined;
}): ReactElement | null {
  const t = useInspectorT();
  switch (a.kind) {
    case "text":
      return <TextPanel a={a} onChange={onChange} />;
    case "arrow":
    case "line":
      return (
        <>
          <Slider
            label={t("inspector.common.width")}
            unit="px"
            min={1}
            max={32}
            value={a.strokeWidth}
            onChange={(strokeWidth) => onChange({ ...a, strokeWidth })}
          />
          <ColorField
            label={t("inspector.common.color")}
            value={a.color}
            onChange={(color) => onChange({ ...a, color })}
          />
          {a.kind === "arrow" && (
            <Row label={t("inspector.annotations.head")}>
              <ChoiceRow
                label={t("inspector.annotations.head")}
                value={a.headStyle}
                options={localize(t, HEAD_OPTIONS)}
                onChange={(headStyle) => onChange({ ...a, headStyle })}
              />
            </Row>
          )}
          <Switch
            label={t("inspector.annotations.dashed")}
            checked={a.dashed}
            onChange={(dashed) => onChange({ ...a, dashed })}
          />
        </>
      );
    case "rect":
    case "ellipse":
      return (
        <>
          <ColorField
            label={t("inspector.common.fill")}
            value={a.fill.slice(0, 7)}
            onChange={(fill) => onChange({ ...a, fill })}
          />
          <ColorField
            label={t("inspector.annotations.stroke")}
            value={a.stroke.slice(0, 7)}
            onChange={(stroke) => onChange({ ...a, stroke })}
          />
          <Slider
            label={t("inspector.annotations.strokeWidth")}
            unit="px"
            min={0}
            max={32}
            value={a.strokeWidth}
            onChange={(strokeWidth) => onChange({ ...a, strokeWidth })}
          />
          <OpacitySlider a={a} onChange={onChange} />
          {a.kind === "rect" && (
            <Slider
              label={t("inspector.common.radius")}
              unit="px"
              min={0}
              max={64}
              value={a.radius}
              onChange={(radius) => onChange({ ...a, radius })}
            />
          )}
        </>
      );
    case "highlight":
      return (
        <>
          <ColorField
            label={t("inspector.common.color")}
            value={a.fill.slice(0, 7)}
            onChange={(fill) => onChange({ ...a, fill })}
          />
          <OpacitySlider a={a} onChange={onChange} />
          <Slider
            label={t("inspector.common.radius")}
            unit="px"
            min={0}
            max={64}
            value={a.radius}
            onChange={(radius) => onChange({ ...a, radius })}
          />
        </>
      );
    case "blur":
      return (
        <>
          <Slider
            label={t("inspector.common.strength")}
            min={1}
            max={64}
            value={a.strength}
            onChange={(strength) => onChange({ ...a, strength })}
          />
          <Switch
            label={t("inspector.annotations.pixelate")}
            hint={t("inspector.annotations.pixelate.hint")}
            checked={a.pixelate}
            onChange={(pixelate) => onChange({ ...a, pixelate })}
          />
        </>
      );
    case "image":
      return (
        <>
          {a.src === "" && (
            <EmptyState title={t("inspector.annotations.noImage.title")} icon="▧">
              {t("inspector.annotations.noImage.body")}
            </EmptyState>
          )}
          {onPickImage && (
            <button
              type="button"
              className="rf-choice"
              onClick={() => onPickImage(a)}
              style={{
                ...pillButtonBase,
                appearance: "none",
                flex: "0 0 auto",
                background: "var(--bg-panel-raised)",
                border: "1px solid var(--border-strong)",
                color: "var(--text-1)",
              }}
            >
              {a.src === ""
                ? t("inspector.annotations.chooseImage")
                : t("inspector.annotations.replaceImage")}
            </button>
          )}
          {imageError ? (
            <Callout tone="danger" role="alert">
              {imageError}
            </Callout>
          ) : null}
          <OpacitySlider a={a} onChange={onChange} />
          <Row label={t("inspector.common.fit")}>
            <ChoiceRow
              label={t("inspector.common.fit")}
              value={a.fit}
              options={localize(t, FIT_OPTIONS)}
              onChange={(fit) => onChange({ ...a, fit })}
            />
          </Row>
          <Slider
            label={t("inspector.common.cornerRadius")}
            unit="px"
            min={0}
            max={64}
            value={a.cornerRadius}
            onChange={(cornerRadius) => onChange({ ...a, cornerRadius })}
          />
        </>
      );
    case "emoji":
      return (
        <TextField
          label={t("inspector.annotations.emoji")}
          value={a.emoji}
          maxLength={8}
          onChange={(emoji) => onChange({ ...a, emoji })}
        />
      );
    case "numberBadge":
      return (
        <>
          <NumberField
            label={t("inspector.annotations.number")}
            min={0}
            max={999}
            value={a.value}
            onChange={(value) => onChange({ ...a, value: Math.round(value) })}
          />
          <ColorField
            label={t("inspector.common.fill")}
            value={a.fill}
            onChange={(fill) => onChange({ ...a, fill })}
          />
          <ColorField
            label={t("inspector.common.text")}
            value={a.color}
            onChange={(color) => onChange({ ...a, color })}
          />
        </>
      );
    case "keystrokeBadge":
      return (
        <TextField
          label={t("inspector.annotations.labelField")}
          value={a.label}
          onChange={(label) => onChange({ ...a, label })}
        />
      );
  }
}

function OpacitySlider({
  a,
  onChange,
}: { a: Annotation; onChange: (a: Annotation) => void }): ReactElement {
  const t = useInspectorT();
  return (
    <Slider
      label={t("inspector.common.opacity")}
      unit="%"
      min={0}
      max={100}
      value={Math.round(a.opacity * 100)}
      onChange={(v) => onChange({ ...a, opacity: clamp(v / 100, 0, 1) })}
    />
  );
}

function TextPanel({
  a,
  onChange,
}: { a: AnnotationOf<"text">; onChange: (a: Annotation) => void }): ReactElement {
  const t = useInspectorT();
  const fontId = useId();
  return (
    <>
      <textarea
        className="rf-valuebox"
        aria-label={t("inspector.annotations.content")}
        rows={3}
        value={a.text}
        onChange={(e) => onChange({ ...a, text: e.target.value })}
        style={{
          ...sunkenFieldStyle,
          padding: "8px 10px",
          borderRadius: "10px",
          minHeight: "52px",
          resize: "vertical",
          lineHeight: 1.4,
        }}
      />
      <FieldRow>
        <span
          className="rf-valuebox"
          style={{ ...sunkenFieldStyle, position: "relative", flex: "1 1 0", padding: 0 }}
        >
          <select
            id={fontId}
            aria-label={t("inspector.common.font")}
            value={a.font}
            onChange={(e) => onChange({ ...a, font: e.target.value as TextFont })}
            style={{
              appearance: "none",
              width: "100%",
              background: "transparent",
              border: 0,
              outline: "none",
              color: "var(--text-1)",
              fontFamily: "var(--font-body)",
              fontSize: "11px",
              padding: "5px 22px 5px 8px",
              cursor: "pointer",
            }}
          >
            {TEXT_FONTS.map((f) => (
              <option key={f} value={f}>
                {t(TEXT_FONT_LABEL_KEYS[f])}
              </option>
            ))}
          </select>
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: "8px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-3)",
              pointerEvents: "none",
            }}
          >
            ⌄
          </span>
        </span>
        <span style={{ flex: "0 0 96px", display: "flex" }}>
          <NumberField
            inline
            label={t("inspector.common.size")}
            unit="px"
            min={8}
            max={160}
            value={a.fontSize}
            onChange={(fontSize) => onChange({ ...a, fontSize })}
          />
        </span>
      </FieldRow>
      <div style={{ ...rowStyle, gap: "8px" }}>
        <Swatch
          label={t("inspector.common.color")}
          value={a.color}
          onChange={(color) => onChange({ ...a, color })}
        />
        {a.background && (
          <Swatch
            label={t("inspector.annotations.pillColor")}
            value={a.backgroundColor}
            onChange={(backgroundColor) => onChange({ ...a, backgroundColor })}
          />
        )}
        <span style={{ flex: "1 1 auto", color: "var(--text-2)" }}>
          {t("inspector.annotations.backgroundPill")}
        </span>
        <Toggle
          label={t("inspector.annotations.backgroundPill")}
          checked={a.background}
          onChange={(background) => onChange({ ...a, background })}
        />
      </div>
      <Row label={t("inspector.annotations.weight")}>
        <ChoiceRow
          label={t("inspector.annotations.weight")}
          value={a.fontWeight}
          options={localize(t, WEIGHT_OPTIONS)}
          onChange={(fontWeight) => onChange({ ...a, fontWeight })}
        />
      </Row>
      <Row label={t("inspector.annotations.align")}>
        <ChoiceRow
          label={t("inspector.annotations.align")}
          value={a.align}
          options={localize(t, ALIGN_OPTIONS)}
          onChange={(align) => onChange({ ...a, align })}
        />
      </Row>
      <Slider
        label={t("inspector.common.padding")}
        labelWidth={60}
        unit="px"
        min={0}
        max={48}
        value={a.padding}
        onChange={(padding) => onChange({ ...a, padding })}
      />
    </>
  );
}
