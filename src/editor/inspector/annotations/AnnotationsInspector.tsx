import { Button, Input, Segmented, Textarea } from "@design/components";
import type { SegmentedOption } from "@design/components";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { ColorField, EmptyState, NumberField, Section, Slider, Switch, clamp } from "../controls";
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

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
};

const toolbarStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(6, 1fr)",
  gap: "var(--space-1)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  minHeight: "28px",
  color: "var(--text-1)",
};

const labelStyle: CSSProperties = { flex: "0 0 96px", color: "var(--text-2)" };

const mutedStyle: CSSProperties = { color: "var(--text-2)", fontSize: "12px" };

function toolButtonStyle(active: boolean): CSSProperties {
  return {
    appearance: "none",
    height: "36px",
    borderRadius: "var(--radius-sm)",
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--bg-active)" : "transparent",
    color: active ? "var(--text-1)" : "var(--text-2)",
    fontSize: "15px",
    cursor: "pointer",
  };
}

type OptionKeys<T> = ReadonlyArray<{ value: T; labelKey: InspectorMessageKey }>;

const localize = <T extends string | number>(
  t: InspectorTranslate,
  list: OptionKeys<T>,
): ReadonlyArray<SegmentedOption<T>> => list.map((o) => ({ value: o.value, label: t(o.labelKey) }));

const ANIM_OPTIONS: OptionKeys<AnimType> = [
  { value: "none", labelKey: "inspector.common.none" },
  { value: "fade", labelKey: "inspector.annotations.anim.fade" },
  { value: "pop", labelKey: "inspector.annotations.anim.pop" },
  { value: "slide", labelKey: "inspector.annotations.anim.slide" },
];

const DIRECTION_OPTIONS: ReadonlyArray<SegmentedOption<SlideDirection>> = [
  { value: "left", label: "◂" },
  { value: "right", label: "▸" },
  { value: "up", label: "▴" },
  { value: "down", label: "▾" },
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

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>{children}</div>
    </div>
  );
}

const pct = (n: number): number => Math.round(n * 1000) / 10;
const secs = (ms: number): number => Math.round(ms) / 1000;

/** Annotate tab (design guide S19). Presentational; all state via props. */
export function AnnotationsInspector(props: AnnotationsInspectorProps): ReactElement {
  const t = useInspectorT();
  const { activeTool, onToolChange, selected } = props;
  return (
    <div style={rootStyle} aria-label={t("inspector.annotations.label")}>
      <div role="toolbar" aria-label={t("inspector.annotations.tools")} style={toolbarStyle}>
        {ANNOTATION_KINDS.map((tool) => {
          const active = activeTool === tool;
          return (
            <button
              key={tool}
              type="button"
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
        <div style={mutedStyle} role="status">
          {t("inspector.annotations.toolHint", { tool: t(TOOL_LABEL_KEYS[activeTool]) })}
        </div>
      )}
      {showKeystrokes && (
        <KeystrokeList shortcuts={detectedShortcuts} onAddAll={onAddAllShortcuts} />
      )}
      <EmptyState title={t("inspector.annotations.empty.title")}>
        <ul
          style={{
            margin: 0,
            paddingLeft: "var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
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
  return (
    <Section title={t("inspector.annotations.keystrokes")}>
      {n === 0 ? (
        <EmptyState title={t("inspector.annotations.noShortcuts.title")}>
          {t("inspector.annotations.noShortcuts.body")}
        </EmptyState>
      ) : (
        <>
          <div style={{ ...rowStyle, justifyContent: "space-between" }}>
            <span>{t("inspector.annotations.detected", { count: n })}</span>
            <Button variant="primary" onClick={onAddAll}>
              {t("inspector.annotations.addAll")}
            </Button>
          </div>
          <ul
            aria-label={t("inspector.annotations.detectedList")}
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {summary.map((s) => (
              <li key={s.label} style={{ ...rowStyle, justifyContent: "space-between" }}>
                <kbd
                  style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: "12px",
                    padding: "1px var(--space-1)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-strong)",
                    background: "var(--bg-sunken)",
                  }}
                >
                  {s.label}
                </kbd>
                <span style={mutedStyle}>×{s.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
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
      <div style={{ ...rowStyle, justifyContent: "space-between" }}>
        <span style={{ fontWeight: 600 }}>{t(TOOL_LABEL_KEYS[a.kind])}</span>
        <span style={{ display: "flex", gap: "var(--space-1)" }}>
          <Button variant="ghost" onClick={() => onDuplicate(a)}>
            {t("inspector.common.duplicate")}
          </Button>
          <Button variant="danger" onClick={() => onDelete(a)}>
            {t("inspector.common.delete")}
          </Button>
        </span>
      </div>

      <KindPanel
        a={a}
        onChange={onChange}
        onPickImage={props.onPickImage}
        imageError={props.imageError}
      />

      <Section title={t("inspector.annotations.animation")}>
        <AnimControls
          direction="in"
          name={`${a.id}-anim-in`}
          anim={a.animIn}
          onChange={(animIn) => onChange({ ...a, animIn })}
        />
        <AnimControls
          direction="out"
          name={`${a.id}-anim-out`}
          anim={a.animOut}
          onChange={(animOut) => onChange({ ...a, animOut })}
        />
      </Section>

      <Section title={t("inspector.common.position")}>
        <NumberField
          label={t("inspector.common.x")}
          unit="%"
          step={0.5}
          min={0}
          max={100}
          value={pct(a.x)}
          onChange={(v) => onChange({ ...a, x: v / 100 })}
        />
        <NumberField
          label={t("inspector.common.y")}
          unit="%"
          step={0.5}
          min={0}
          max={100}
          value={pct(a.y)}
          onChange={(v) => onChange({ ...a, y: v / 100 })}
        />
        <NumberField
          label={t("inspector.common.w")}
          unit="%"
          step={0.5}
          min={0.5}
          max={100}
          value={pct(a.w)}
          onChange={(v) => onChange({ ...a, w: v / 100 })}
        />
        <NumberField
          label={t("inspector.common.h")}
          unit="%"
          step={0.5}
          min={0.5}
          max={100}
          value={pct(a.h)}
          onChange={(v) => onChange({ ...a, h: v / 100 })}
        />
        <NumberField
          label={t("inspector.annotations.rotation")}
          unit="°"
          min={-180}
          max={180}
          value={a.rotation}
          onChange={(rotation) => onChange({ ...a, rotation })}
        />
        <Switch
          label={t("inspector.annotations.followZoom")}
          hint={t("inspector.annotations.followZoom.hint")}
          checked={a.followZoom}
          onChange={(followZoom) => onChange({ ...a, followZoom })}
        />
      </Section>

      <Section title={t("inspector.common.timing")}>
        <NumberField
          label={t("inspector.common.start")}
          unit="s"
          step={0.1}
          min={0}
          value={secs(a.startMs)}
          onChange={(v) => onChange(updateTiming(a, { startMs: v * 1000 }, timelineDurationMs))}
        />
        <NumberField
          label={t("inspector.common.end")}
          unit="s"
          step={0.1}
          min={0}
          value={secs(a.endMs)}
          onChange={(v) => onChange(updateTiming(a, { endMs: v * 1000 }, timelineDurationMs))}
        />
        <div style={mutedStyle}>
          {t("inspector.annotations.durationSeconds", { seconds: secs(a.endMs - a.startMs) })}
        </div>
      </Section>
    </>
  );
}

function AnimControls({
  direction,
  name,
  anim,
  onChange,
}: {
  direction: keyof typeof ANIM_LABEL_KEYS;
  name: string;
  anim: AnnotationAnim;
  onChange: (anim: AnnotationAnim) => void;
}): ReactElement {
  const t = useInspectorT();
  const keys = ANIM_LABEL_KEYS[direction];
  return (
    <div
      role="group"
      aria-label={t(keys.group)}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
    >
      <Row label={t(keys.label)}>
        <Segmented
          name={name}
          value={anim.type}
          options={localize(t, ANIM_OPTIONS)}
          onChange={(type) => onChange({ ...anim, type })}
        />
      </Row>
      {anim.type === "slide" && (
        <Row label={t("inspector.annotations.anim.from")}>
          <Segmented
            name={`${name}-dir`}
            value={anim.direction}
            options={DIRECTION_OPTIONS}
            onChange={(direction) => onChange({ ...anim, direction })}
          />
        </Row>
      )}
      <Slider
        label={t(keys.duration)}
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
        <Section title={t("inspector.annotations.stroke")}>
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
              <Segmented
                name={`${a.id}-head`}
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
        </Section>
      );
    case "rect":
    case "ellipse":
      return (
        <Section title={t("inspector.annotations.shape")}>
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
        </Section>
      );
    case "highlight":
      return (
        <Section title={t("inspector.common.highlight")}>
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
        </Section>
      );
    case "blur":
      return (
        <Section title={t("inspector.common.blur")}>
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
        </Section>
      );
    case "image":
      return (
        <Section title={t("inspector.common.image")}>
          {a.src === "" && (
            <EmptyState title={t("inspector.annotations.noImage.title")}>
              {t("inspector.annotations.noImage.body")}
            </EmptyState>
          )}
          {onPickImage && (
            <Button variant="secondary" block onClick={() => onPickImage(a)}>
              {a.src === ""
                ? t("inspector.annotations.chooseImage")
                : t("inspector.annotations.replaceImage")}
            </Button>
          )}
          {imageError ? (
            <span role="alert" style={{ color: "var(--danger)", fontSize: "12px" }}>
              {imageError}
            </span>
          ) : null}
          <OpacitySlider a={a} onChange={onChange} />
          <Row label={t("inspector.common.fit")}>
            <Segmented
              name={`${a.id}-fit`}
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
        </Section>
      );
    case "emoji":
      return (
        <Section title={t("inspector.annotations.emoji")}>
          <Input
            label={t("inspector.annotations.emoji")}
            value={a.emoji}
            maxLength={8}
            onChange={(e) => onChange({ ...a, emoji: e.target.value })}
          />
        </Section>
      );
    case "numberBadge":
      return (
        <Section title={t("inspector.annotations.badge")}>
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
        </Section>
      );
    case "keystrokeBadge":
      return (
        <Section title={t("inspector.annotations.keystroke")}>
          <Input
            label={t("inspector.annotations.labelField")}
            value={a.label}
            onChange={(e) => onChange({ ...a, label: e.target.value })}
          />
        </Section>
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
  return (
    <Section title={t("inspector.common.text")}>
      <Textarea
        label={t("inspector.annotations.content")}
        rows={3}
        value={a.text}
        onChange={(e) => onChange({ ...a, text: e.target.value })}
      />
      <Row label={t("inspector.common.font")}>
        <select
          aria-label={t("inspector.common.font")}
          className="input"
          value={a.font}
          onChange={(e) => onChange({ ...a, font: e.target.value as TextFont })}
        >
          {TEXT_FONTS.map((f) => (
            <option key={f} value={f}>
              {t(TEXT_FONT_LABEL_KEYS[f])}
            </option>
          ))}
        </select>
      </Row>
      <Slider
        label={t("inspector.common.size")}
        unit="px"
        min={8}
        max={160}
        value={a.fontSize}
        onChange={(fontSize) => onChange({ ...a, fontSize })}
      />
      <Row label={t("inspector.annotations.weight")}>
        <Segmented
          name={`${a.id}-weight`}
          value={a.fontWeight}
          options={localize(t, WEIGHT_OPTIONS)}
          onChange={(fontWeight) => onChange({ ...a, fontWeight })}
        />
      </Row>
      <ColorField
        label={t("inspector.common.color")}
        value={a.color}
        onChange={(color) => onChange({ ...a, color })}
      />
      <Switch
        label={t("inspector.annotations.backgroundPill")}
        checked={a.background}
        onChange={(background) => onChange({ ...a, background })}
      />
      {a.background && (
        <ColorField
          label={t("inspector.annotations.pillColor")}
          value={a.backgroundColor}
          onChange={(backgroundColor) => onChange({ ...a, backgroundColor })}
        />
      )}
      <Slider
        label={t("inspector.common.padding")}
        unit="px"
        min={0}
        max={48}
        value={a.padding}
        onChange={(padding) => onChange({ ...a, padding })}
      />
      <Row label={t("inspector.annotations.align")}>
        <Segmented
          name={`${a.id}-align`}
          value={a.align}
          options={localize(t, ALIGN_OPTIONS)}
          onChange={(align) => onChange({ ...a, align })}
        />
      </Row>
    </Section>
  );
}
