import { Button, Input, Segmented, Textarea } from "@design/components";
import type { SegmentedOption } from "@design/components";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { ColorField, EmptyState, NumberField, Section, Slider, Switch, clamp } from "../controls";
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
  TOOL_GLYPHS,
  TOOL_LABELS,
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

const ANIM_OPTIONS: ReadonlyArray<SegmentedOption<AnimType>> = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "pop", label: "Pop" },
  { value: "slide", label: "Slide" },
];

const DIRECTION_OPTIONS: ReadonlyArray<SegmentedOption<SlideDirection>> = [
  { value: "left", label: "◂" },
  { value: "right", label: "▸" },
  { value: "up", label: "▴" },
  { value: "down", label: "▾" },
];

const WEIGHT_OPTIONS: ReadonlyArray<SegmentedOption<FontWeight>> = [
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 700, label: "Bold" },
];

const ALIGN_OPTIONS: ReadonlyArray<SegmentedOption<TextAlign>> = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

const HEAD_OPTIONS: ReadonlyArray<SegmentedOption<ArrowHeadStyle>> = [
  { value: "triangle", label: "Solid" },
  { value: "open", label: "Open" },
  { value: "circle", label: "Dot" },
  { value: "none", label: "None" },
];

const FIT_OPTIONS: ReadonlyArray<SegmentedOption<ImageFit>> = [
  { value: "contain", label: "Contain" },
  { value: "cover", label: "Cover" },
  { value: "fill", label: "Fill" },
];

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
  const { activeTool, onToolChange, selected } = props;
  return (
    <div style={rootStyle} aria-label="Annotate inspector">
      <div role="toolbar" aria-label="Annotation tools" style={toolbarStyle}>
        {ANNOTATION_KINDS.map((tool) => {
          const active = activeTool === tool;
          return (
            <button
              key={tool}
              type="button"
              title={TOOL_LABELS[tool]}
              aria-label={TOOL_LABELS[tool]}
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
  const showKeystrokes = detectedShortcuts.length > 0 || activeTool === "keystrokeBadge";
  return (
    <>
      {activeTool && (
        <div style={mutedStyle} role="status">
          {TOOL_LABELS[activeTool]} — click or drag on the canvas to place it at the playhead.
        </div>
      )}
      {showKeystrokes && (
        <KeystrokeList shortcuts={detectedShortcuts} onAddAll={onAddAllShortcuts} />
      )}
      <EmptyState title="No annotation selected">
        <ul
          style={{
            margin: 0,
            paddingLeft: "var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          <li>Pick a tool, then click or drag on the canvas.</li>
          <li>New annotations start at the playhead and last 3s.</li>
          <li>Number badges count up automatically: 1, 2, 3.</li>
          <li>Select an annotation on the canvas or timeline to edit it.</li>
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
  const summary = summarizeShortcuts(shortcuts);
  const n = shortcuts.length;
  return (
    <Section title="Keystroke badges">
      {n === 0 ? (
        <EmptyState title="No shortcuts detected">
          Shortcuts pressed while recording will appear here.
        </EmptyState>
      ) : (
        <>
          <div style={{ ...rowStyle, justifyContent: "space-between" }}>
            <span>
              Detected {n} shortcut{n === 1 ? "" : "s"}
            </span>
            <Button variant="primary" onClick={onAddAll}>
              Add all
            </Button>
          </div>
          <ul aria-label="Detected shortcuts" style={{ listStyle: "none", margin: 0, padding: 0 }}>
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
        <span style={{ fontWeight: 600 }}>{TOOL_LABELS[a.kind]}</span>
        <span style={{ display: "flex", gap: "var(--space-1)" }}>
          <Button variant="ghost" onClick={() => onDuplicate(a)}>
            Duplicate
          </Button>
          <Button variant="danger" onClick={() => onDelete(a)}>
            Delete
          </Button>
        </span>
      </div>

      <KindPanel
        a={a}
        onChange={onChange}
        onPickImage={props.onPickImage}
        imageError={props.imageError}
      />

      <Section title="Animation">
        <AnimControls
          label="In"
          name={`${a.id}-anim-in`}
          anim={a.animIn}
          onChange={(animIn) => onChange({ ...a, animIn })}
        />
        <AnimControls
          label="Out"
          name={`${a.id}-anim-out`}
          anim={a.animOut}
          onChange={(animOut) => onChange({ ...a, animOut })}
        />
      </Section>

      <Section title="Position">
        <NumberField
          label="X"
          unit="%"
          step={0.5}
          min={0}
          max={100}
          value={pct(a.x)}
          onChange={(v) => onChange({ ...a, x: v / 100 })}
        />
        <NumberField
          label="Y"
          unit="%"
          step={0.5}
          min={0}
          max={100}
          value={pct(a.y)}
          onChange={(v) => onChange({ ...a, y: v / 100 })}
        />
        <NumberField
          label="W"
          unit="%"
          step={0.5}
          min={0.5}
          max={100}
          value={pct(a.w)}
          onChange={(v) => onChange({ ...a, w: v / 100 })}
        />
        <NumberField
          label="H"
          unit="%"
          step={0.5}
          min={0.5}
          max={100}
          value={pct(a.h)}
          onChange={(v) => onChange({ ...a, h: v / 100 })}
        />
        <NumberField
          label="Rotation"
          unit="°"
          min={-180}
          max={180}
          value={a.rotation}
          onChange={(rotation) => onChange({ ...a, rotation })}
        />
        <Switch
          label="Follow zoom"
          hint="Moves with the camera"
          checked={a.followZoom}
          onChange={(followZoom) => onChange({ ...a, followZoom })}
        />
      </Section>

      <Section title="Timing">
        <NumberField
          label="Start"
          unit="s"
          step={0.1}
          min={0}
          value={secs(a.startMs)}
          onChange={(v) => onChange(updateTiming(a, { startMs: v * 1000 }, timelineDurationMs))}
        />
        <NumberField
          label="End"
          unit="s"
          step={0.1}
          min={0}
          value={secs(a.endMs)}
          onChange={(v) => onChange(updateTiming(a, { endMs: v * 1000 }, timelineDurationMs))}
        />
        <div style={mutedStyle}>Duration {secs(a.endMs - a.startMs)}s</div>
      </Section>
    </>
  );
}

function AnimControls({
  label,
  name,
  anim,
  onChange,
}: {
  label: string;
  name: string;
  anim: AnnotationAnim;
  onChange: (anim: AnnotationAnim) => void;
}): ReactElement {
  return (
    <div
      role="group"
      aria-label={`Animation ${label.toLowerCase()}`}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
    >
      <Row label={label}>
        <Segmented
          name={name}
          value={anim.type}
          options={ANIM_OPTIONS}
          onChange={(type) => onChange({ ...anim, type })}
        />
      </Row>
      {anim.type === "slide" && (
        <Row label="From">
          <Segmented
            name={`${name}-dir`}
            value={anim.direction}
            options={DIRECTION_OPTIONS}
            onChange={(direction) => onChange({ ...anim, direction })}
          />
        </Row>
      )}
      <Slider
        label={`${label} duration`}
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
  switch (a.kind) {
    case "text":
      return <TextPanel a={a} onChange={onChange} />;
    case "arrow":
    case "line":
      return (
        <Section title="Stroke">
          <Slider
            label="Width"
            unit="px"
            min={1}
            max={32}
            value={a.strokeWidth}
            onChange={(strokeWidth) => onChange({ ...a, strokeWidth })}
          />
          <ColorField
            label="Color"
            value={a.color}
            onChange={(color) => onChange({ ...a, color })}
          />
          {a.kind === "arrow" && (
            <Row label="Head">
              <Segmented
                name={`${a.id}-head`}
                value={a.headStyle}
                options={HEAD_OPTIONS}
                onChange={(headStyle) => onChange({ ...a, headStyle })}
              />
            </Row>
          )}
          <Switch
            label="Dashed"
            checked={a.dashed}
            onChange={(dashed) => onChange({ ...a, dashed })}
          />
        </Section>
      );
    case "rect":
    case "ellipse":
      return (
        <Section title="Shape">
          <ColorField
            label="Fill"
            value={a.fill.slice(0, 7)}
            onChange={(fill) => onChange({ ...a, fill })}
          />
          <ColorField
            label="Stroke"
            value={a.stroke.slice(0, 7)}
            onChange={(stroke) => onChange({ ...a, stroke })}
          />
          <Slider
            label="Stroke width"
            unit="px"
            min={0}
            max={32}
            value={a.strokeWidth}
            onChange={(strokeWidth) => onChange({ ...a, strokeWidth })}
          />
          <OpacitySlider a={a} onChange={onChange} />
          {a.kind === "rect" && (
            <Slider
              label="Radius"
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
        <Section title="Highlight">
          <ColorField
            label="Color"
            value={a.fill.slice(0, 7)}
            onChange={(fill) => onChange({ ...a, fill })}
          />
          <OpacitySlider a={a} onChange={onChange} />
          <Slider
            label="Radius"
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
        <Section title="Blur">
          <Slider
            label="Strength"
            min={1}
            max={64}
            value={a.strength}
            onChange={(strength) => onChange({ ...a, strength })}
          />
          <Switch
            label="Pixelate"
            hint="Mosaic instead of blur"
            checked={a.pixelate}
            onChange={(pixelate) => onChange({ ...a, pixelate })}
          />
        </Section>
      );
    case "image":
      return (
        <Section title="Image">
          {a.src === "" && <EmptyState title="No image">Drop an image onto the canvas.</EmptyState>}
          {onPickImage && (
            <Button variant="secondary" block onClick={() => onPickImage(a)}>
              {a.src === "" ? "Choose image…" : "Replace image…"}
            </Button>
          )}
          {imageError ? (
            <span role="alert" style={{ color: "var(--danger)", fontSize: "12px" }}>
              {imageError}
            </span>
          ) : null}
          <OpacitySlider a={a} onChange={onChange} />
          <Row label="Fit">
            <Segmented
              name={`${a.id}-fit`}
              value={a.fit}
              options={FIT_OPTIONS}
              onChange={(fit) => onChange({ ...a, fit })}
            />
          </Row>
          <Slider
            label="Corner radius"
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
        <Section title="Emoji">
          <Input
            label="Emoji"
            value={a.emoji}
            maxLength={8}
            onChange={(e) => onChange({ ...a, emoji: e.target.value })}
          />
        </Section>
      );
    case "numberBadge":
      return (
        <Section title="Badge">
          <NumberField
            label="Number"
            min={0}
            max={999}
            value={a.value}
            onChange={(value) => onChange({ ...a, value: Math.round(value) })}
          />
          <ColorField label="Fill" value={a.fill} onChange={(fill) => onChange({ ...a, fill })} />
          <ColorField
            label="Text"
            value={a.color}
            onChange={(color) => onChange({ ...a, color })}
          />
        </Section>
      );
    case "keystrokeBadge":
      return (
        <Section title="Keystroke">
          <Input
            label="Label"
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
  return (
    <Slider
      label="Opacity"
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
  return (
    <Section title="Text">
      <Textarea
        label="Content"
        rows={3}
        value={a.text}
        onChange={(e) => onChange({ ...a, text: e.target.value })}
      />
      <Row label="Font">
        <select
          aria-label="Font"
          className="input"
          value={a.font}
          onChange={(e) => onChange({ ...a, font: e.target.value as TextFont })}
        >
          {TEXT_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Row>
      <Slider
        label="Size"
        unit="px"
        min={8}
        max={160}
        value={a.fontSize}
        onChange={(fontSize) => onChange({ ...a, fontSize })}
      />
      <Row label="Weight">
        <Segmented
          name={`${a.id}-weight`}
          value={a.fontWeight}
          options={WEIGHT_OPTIONS}
          onChange={(fontWeight) => onChange({ ...a, fontWeight })}
        />
      </Row>
      <ColorField label="Color" value={a.color} onChange={(color) => onChange({ ...a, color })} />
      <Switch
        label="Background pill"
        checked={a.background}
        onChange={(background) => onChange({ ...a, background })}
      />
      {a.background && (
        <ColorField
          label="Pill color"
          value={a.backgroundColor}
          onChange={(backgroundColor) => onChange({ ...a, backgroundColor })}
        />
      )}
      <Slider
        label="Padding"
        unit="px"
        min={0}
        max={48}
        value={a.padding}
        onChange={(padding) => onChange({ ...a, padding })}
      />
      <Row label="Align">
        <Segmented
          name={`${a.id}-align`}
          value={a.align}
          options={ALIGN_OPTIONS}
          onChange={(align) => onChange({ ...a, align })}
        />
      </Row>
    </Section>
  );
}
