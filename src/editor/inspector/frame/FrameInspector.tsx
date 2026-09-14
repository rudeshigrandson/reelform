import { Button, Segmented } from "@design/components";
import {
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import { ColorField, NumberField, Section, Slider, Switch } from "../controls";
import {
  type PaddingSide,
  addGradientStop,
  applyPreset,
  findMatchingPreset,
  gradientToCss,
  outputSize,
  removeGradientStop,
  resolvePadding,
  setPaddingAll,
  setPaddingMatchAll,
  setPaddingSide,
  updateGradientStop,
  validateCustomSize,
} from "./frameLogic";
import {
  type AspectPreset,
  BUILT_IN_FRAME_PRESETS,
  type BackgroundKind,
  FRAME_LIMITS,
  type FramePreset,
  type FrameSettings,
  PLACEHOLDER_WALLPAPERS,
  type Size,
  WALLPAPER_CATEGORIES,
  type Wallpaper,
  type WallpaperCategory,
} from "./types";

export type FrameSectionId =
  | "background"
  | "blur"
  | "padding"
  | "radius"
  | "shadow"
  | "border"
  | "aspect"
  | "inset";

export interface FrameInspectorProps {
  value: FrameSettings;
  onChange: (next: FrameSettings) => void;
  /** Wallpaper catalogue (bundled + custom). Defaults to the placeholder pack. */
  wallpapers?: readonly Wallpaper[] | undefined;
  /** User-saved presets shown after the bundled ones. */
  userPresets?: readonly FramePreset[] | undefined;
  /** Recording size, used for the "Source" aspect readout. */
  sourceSize?: Size | null | undefined;
  /** Remembered collapse state: `true` = collapsed. Sections are open by default. */
  collapsed?: Partial<Record<FrameSectionId, boolean>> | undefined;
  onSectionToggle?: ((id: FrameSectionId, open: boolean) => void) | undefined;
  /** "Save current as preset…" — host opens a naming dialog. Button disabled when absent. */
  onSavePreset?: (() => void) | undefined;
  /** "Add custom…" wallpaper tile. Hidden when absent. */
  onAddCustomWallpaper?: (() => void) | undefined;
  /** Image dropped or browsed; host copies it into `media/` and updates `background.image.path`. */
  onImageSelect?: ((file: File) => void) | undefined;
}

const stack: CSSProperties = { display: "flex", flexDirection: "column", gap: "var(--space-2)" };
const hint: CSSProperties = { fontSize: "11px", color: "var(--text-3)" };
const mono: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "12px",
};

function chip(active: boolean): CSSProperties {
  return {
    appearance: "none",
    cursor: "pointer",
    fontSize: "12px",
    padding: "2px var(--space-2)",
    borderRadius: "999px",
    border: `1px solid ${active ? "var(--accent)" : "var(--border-strong)"}`,
    background: active ? "var(--accent-soft)" : "transparent",
    color: active ? "var(--text-1)" : "var(--text-2)",
  };
}

const BACKGROUND_OPTIONS: ReadonlyArray<{ value: BackgroundKind; label: string }> = [
  { value: "wallpaper", label: "Wallpaper" },
  { value: "color", label: "Color" },
  { value: "gradient", label: "Gradient" },
  { value: "image", label: "Image" },
  { value: "none", label: "None" },
];

const ASPECT_OPTIONS: ReadonlyArray<{ value: AspectPreset; label: string }> = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "4:5", label: "4:5" },
  { value: "21:9", label: "21:9" },
  { value: "source", label: "Source" },
  { value: "custom", label: "Custom" },
];

const SECTION_TITLES: Record<FrameSectionId, string> = {
  background: "Background",
  blur: "Blur",
  padding: "Padding",
  radius: "Corner radius",
  shadow: "Shadow",
  border: "Border",
  aspect: "Aspect ratio",
  inset: "Inset",
};

export function FrameInspector(props: FrameInspectorProps): ReactElement {
  const { value, onChange, collapsed, onSectionToggle } = props;
  const set = (patch: Partial<FrameSettings>): void => onChange({ ...value, ...patch });

  const section = (id: FrameSectionId, children: ReactNode): ReactElement => (
    <FrameSection id={id} collapsed={collapsed?.[id] === true} onToggle={onSectionToggle}>
      {children}
    </FrameSection>
  );

  const blurApplies = value.background.kind === "wallpaper" || value.background.kind === "image";
  const pad = resolvePadding(value.padding);

  return (
    <div
      aria-label="Frame inspector"
      role="region"
      style={{
        ...stack,
        gap: 0,
        padding: "var(--space-2) var(--space-3)",
        color: "var(--text-1)",
        fontSize: "13px",
      }}
    >
      <PresetsRow {...props} />

      {section("background", <BackgroundEditor {...props} />)}

      {section(
        "blur",
        <>
          <Slider
            label="Background blur"
            value={value.blur}
            min={FRAME_LIMITS.blur.min}
            max={FRAME_LIMITS.blur.max}
            unit="px"
            disabled={!blurApplies}
            onChange={(blur) => set({ blur })}
          />
          {!blurApplies && <span style={hint}>Applies to wallpaper and image backgrounds.</span>}
        </>,
      )}

      {section(
        "padding",
        <>
          <Slider
            label="Padding"
            value={
              value.padding.matchAll
                ? value.padding.all
                : Math.max(pad.top, pad.right, pad.bottom, pad.left)
            }
            min={FRAME_LIMITS.padding.min}
            max={FRAME_LIMITS.padding.max}
            unit="px"
            onChange={(n) => set({ padding: setPaddingAll(value.padding, n) })}
          />
          <Switch
            label="Match all sides"
            checked={value.padding.matchAll}
            onChange={(on) => set({ padding: setPaddingMatchAll(value.padding, on) })}
          />
          {!value.padding.matchAll && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                columnGap: "var(--space-2)",
              }}
            >
              {(
                [
                  ["top", "Top"],
                  ["right", "Right"],
                  ["bottom", "Bottom"],
                  ["left", "Left"],
                ] as ReadonlyArray<[PaddingSide, string]>
              ).map(([side, label]) => (
                <NumberField
                  key={side}
                  label={label}
                  value={pad[side]}
                  min={FRAME_LIMITS.padding.min}
                  max={FRAME_LIMITS.padding.max}
                  unit="px"
                  onChange={(n) => set({ padding: setPaddingSide(value.padding, side, n) })}
                />
              ))}
            </div>
          )}
        </>,
      )}

      {section(
        "radius",
        <>
          <Slider
            label="Corner radius"
            value={value.radius}
            min={FRAME_LIMITS.radius.min}
            max={FRAME_LIMITS.radius.max}
            unit="px"
            onChange={(radius) => set({ radius })}
          />
          <Switch
            label="Squircle"
            checked={value.squircle}
            onChange={(squircle) => set({ squircle })}
          />
        </>,
      )}

      {section(
        "shadow",
        <>
          <Slider
            label="Strength"
            value={value.shadow.strength}
            min={FRAME_LIMITS.shadowStrength.min}
            max={FRAME_LIMITS.shadowStrength.max}
            onChange={(strength) => set({ shadow: { ...value.shadow, strength } })}
          />
          <Slider
            label="Offset Y"
            value={value.shadow.offsetY}
            min={FRAME_LIMITS.shadowOffsetY.min}
            max={FRAME_LIMITS.shadowOffsetY.max}
            unit="px"
            onChange={(offsetY) => set({ shadow: { ...value.shadow, offsetY } })}
          />
          <Slider
            label="Shadow blur"
            value={value.shadow.blur}
            min={FRAME_LIMITS.shadowBlur.min}
            max={FRAME_LIMITS.shadowBlur.max}
            unit="px"
            onChange={(blur) => set({ shadow: { ...value.shadow, blur } })}
          />
          <ColorField
            label="Shadow color"
            value={value.shadow.color}
            onChange={(color) => set({ shadow: { ...value.shadow, color } })}
          />
        </>,
      )}

      {section(
        "border",
        <>
          <Slider
            label="Width"
            value={value.border.width}
            min={FRAME_LIMITS.borderWidth.min}
            max={FRAME_LIMITS.borderWidth.max}
            unit="px"
            onChange={(width) => set({ border: { ...value.border, width } })}
          />
          <ColorField
            label="Border color"
            value={value.border.color}
            onChange={(color) => set({ border: { ...value.border, color } })}
          />
          <Slider
            label="Opacity"
            value={value.border.opacity}
            min={FRAME_LIMITS.borderOpacity.min}
            max={FRAME_LIMITS.borderOpacity.max}
            unit="%"
            onChange={(opacity) => set({ border: { ...value.border, opacity } })}
          />
        </>,
      )}

      {section("aspect", <AspectEditor {...props} />)}

      {section(
        "inset",
        <>
          <Slider
            label="Source scale"
            value={value.inset}
            min={FRAME_LIMITS.inset.min}
            max={FRAME_LIMITS.inset.max}
            unit="%"
            onChange={(inset) => set({ inset })}
          />
          <span style={hint}>How big the recording sits inside the frame.</span>
        </>,
      )}
    </div>
  );
}

/** Section wrapper that reports header toggles so the host can remember collapse state. */
function FrameSection({
  id,
  collapsed,
  onToggle,
  children,
}: {
  id: FrameSectionId;
  collapsed: boolean;
  onToggle: ((id: FrameSectionId, open: boolean) => void) | undefined;
  children: ReactNode;
}): ReactElement {
  const handleClick = (e: MouseEvent<HTMLDivElement>): void => {
    if (!onToggle) return;
    const header = e.currentTarget.querySelector(":scope > section > button[aria-expanded]");
    if (header && header.contains(e.target as Node)) {
      // Fires before Section's state update, so the attribute still holds the old value.
      onToggle(id, header.getAttribute("aria-expanded") !== "true");
    }
  };
  return (
    <div data-section={id} onClick={handleClick}>
      <Section title={SECTION_TITLES[id]} defaultOpen={!collapsed}>
        {children}
      </Section>
    </div>
  );
}

function PresetsRow({
  value,
  onChange,
  userPresets,
  onSavePreset,
}: FrameInspectorProps): ReactElement {
  const all = [...BUILT_IN_FRAME_PRESETS, ...(userPresets ?? [])];
  const active = findMatchingPreset(value, all);
  return (
    <div
      role="group"
      aria-label="Presets"
      style={{
        ...stack,
        paddingBlock: "var(--space-2)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
        {all.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={active === p.id}
            onClick={() => onChange(applyPreset(value, p))}
            style={chip(active === p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <Button variant="ghost" disabled={!onSavePreset} onClick={() => onSavePreset?.()}>
        Save current as preset…
      </Button>
    </div>
  );
}

function BackgroundEditor(props: FrameInspectorProps): ReactElement {
  const { value, onChange } = props;
  const name = useId();
  const bg = value.background;
  const setBg = (patch: Partial<FrameSettings["background"]>): void =>
    onChange({ ...value, background: { ...bg, ...patch } });
  return (
    <div style={stack}>
      <Segmented
        name={`${name}-bg`}
        value={bg.kind}
        options={BACKGROUND_OPTIONS}
        onChange={(kind) => setBg({ kind })}
      />
      {bg.kind === "wallpaper" && <WallpaperGrid {...props} />}
      {bg.kind === "color" && (
        <ColorField
          label="Background color"
          value={bg.color}
          onChange={(color) => setBg({ color })}
        />
      )}
      {bg.kind === "gradient" && <GradientEditor {...props} />}
      {bg.kind === "image" && <ImagePanel {...props} />}
      {bg.kind === "none" && (
        <span style={hint}>Transparent — exports with alpha for WebM/GIF, black for MP4.</span>
      )}
    </div>
  );
}

function WallpaperGrid({
  value,
  onChange,
  wallpapers,
  onAddCustomWallpaper,
}: FrameInspectorProps): ReactElement {
  const list = wallpapers ?? PLACEHOLDER_WALLPAPERS;
  const selected = list.find((w) => w.id === value.background.wallpaperId);
  const [category, setCategory] = useState<WallpaperCategory>(selected?.category ?? "Abstract");
  const shown = list.filter((w) => w.category === category);
  return (
    <div style={stack}>
      <div
        role="group"
        aria-label="Wallpaper categories"
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}
      >
        {WALLPAPER_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={c === category}
            onClick={() => setCategory(c)}
            style={chip(c === category)}
          >
            {c}
          </button>
        ))}
      </div>
      <div
        role="listbox"
        aria-label="Wallpapers"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-1)" }}
      >
        {shown.map((w) => {
          const isSel = w.id === value.background.wallpaperId;
          return (
            <button
              key={w.id}
              type="button"
              role="option"
              aria-selected={isSel}
              aria-label={w.name}
              title={w.name}
              onClick={() =>
                onChange({
                  ...value,
                  background: { ...value.background, kind: "wallpaper", wallpaperId: w.id },
                })
              }
              style={{
                appearance: "none",
                cursor: "pointer",
                aspectRatio: "16 / 10",
                borderRadius: "6px",
                background: w.preview,
                border: `2px solid ${isSel ? "var(--accent)" : "transparent"}`,
                padding: 0,
              }}
            />
          );
        })}
        {onAddCustomWallpaper && (
          <button
            type="button"
            onClick={onAddCustomWallpaper}
            style={{
              appearance: "none",
              cursor: "pointer",
              aspectRatio: "16 / 10",
              borderRadius: "6px",
              border: "1px dashed var(--border-strong)",
              background: "transparent",
              color: "var(--text-2)",
              fontSize: "11px",
            }}
          >
            Add custom…
          </button>
        )}
      </div>
      {shown.length === 0 && !onAddCustomWallpaper && (
        <span style={hint}>No wallpapers in this category.</span>
      )}
    </div>
  );
}

function GradientEditor({ value, onChange }: FrameInspectorProps): ReactElement {
  const name = useId();
  const g = value.background.gradient;
  const setG = (gradient: FrameSettings["background"]["gradient"]): void =>
    onChange({ ...value, background: { ...value.background, gradient } });
  const { min, max } = FRAME_LIMITS.gradientStops;
  return (
    <div style={stack} aria-label="Gradient editor" role="group">
      <div
        data-testid="gradient-preview"
        style={{
          height: "28px",
          borderRadius: "6px",
          background: gradientToCss(g),
          border: "1px solid var(--border-strong)",
        }}
      />
      <Segmented
        name={`${name}-gtype`}
        value={g.type}
        options={[
          { value: "linear", label: "Linear" },
          { value: "radial", label: "Radial" },
        ]}
        onChange={(type) => setG({ ...g, type })}
      />
      {g.type === "linear" && (
        <Slider
          label="Angle"
          value={g.angle}
          min={FRAME_LIMITS.gradientAngle.min}
          max={FRAME_LIMITS.gradientAngle.max}
          unit="°"
          onChange={(angle) => setG({ ...g, angle })}
        />
      )}
      {g.stops.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
          <div style={{ flex: "1 1 auto", ...stack, gap: 0 }}>
            <ColorField
              label={`Stop ${i + 1} color`}
              value={s.color}
              onChange={(color) => setG(updateGradientStop(g, i, { color }))}
            />
            <Slider
              label={`Stop ${i + 1} position`}
              value={s.position}
              min={0}
              max={100}
              unit="%"
              onChange={(position) => setG(updateGradientStop(g, i, { position }))}
            />
          </div>
          <Button
            variant="ghost"
            icon
            aria-label={`Remove stop ${i + 1}`}
            disabled={g.stops.length <= min}
            onClick={() => setG(removeGradientStop(g, i))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        disabled={g.stops.length >= max}
        onClick={() => setG(addGradientStop(g))}
      >
        Add stop
      </Button>
    </div>
  );
}

function ImagePanel({ value, onChange, onImageSelect }: FrameInspectorProps): ReactElement {
  const [hover, setHover] = useState(false);
  const inputId = useId();
  const name = useId();
  const img = value.background.image;
  const setImg = (patch: Partial<FrameSettings["background"]["image"]>): void =>
    onChange({ ...value, background: { ...value.background, image: { ...img, ...patch } } });

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setHover(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) onImageSelect?.(file);
  };

  const state = img.path ? "filled" : hover ? "hover" : "empty";
  const fileName = img.path ? (img.path.split(/[\\/]/).pop() ?? img.path) : null;

  return (
    <div style={stack}>
      <div
        data-testid="image-dropzone"
        data-state={state}
        onDragOver={(e) => {
          e.preventDefault();
          if (!hover) setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={onDrop}
        style={{
          ...stack,
          alignItems: "center",
          justifyContent: "center",
          minHeight: "96px",
          padding: "var(--space-3)",
          borderRadius: "8px",
          border: `1px dashed ${hover ? "var(--accent)" : "var(--border-strong)"}`,
          background: hover ? "var(--accent-soft)" : "var(--bg-sunken)",
          textAlign: "center",
        }}
      >
        {fileName ? (
          <>
            <span style={{ ...mono, color: "var(--text-1)" }}>{fileName}</span>
            <div style={{ display: "flex", gap: "var(--space-1)" }}>
              <label htmlFor={inputId} className="btn btn-ghost" style={{ cursor: "pointer" }}>
                Replace…
              </label>
              <Button variant="ghost" onClick={() => setImg({ path: null })}>
                Remove
              </Button>
            </div>
          </>
        ) : (
          <>
            <span>{hover ? "Drop to use as background" : "Drop an image here"}</span>
            <label htmlFor={inputId} className="btn btn-ghost" style={{ cursor: "pointer" }}>
              Browse…
            </label>
          </>
        )}
        <input
          id={inputId}
          data-testid="image-input"
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImageSelect?.(file);
            e.target.value = "";
          }}
        />
      </div>
      <Segmented
        name={`${name}-fit`}
        value={img.fit}
        options={[
          { value: "fit", label: "Fit" },
          { value: "fill", label: "Fill" },
        ]}
        onChange={(fit) => setImg({ fit })}
      />
    </div>
  );
}

function AspectEditor({ value, onChange, sourceSize }: FrameInspectorProps): ReactElement {
  const name = useId();
  const a = value.aspect;
  const [draftW, setDraftW] = useState(String(a.customWidth));
  const [draftH, setDraftH] = useState(String(a.customHeight));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftW(String(a.customWidth));
    setDraftH(String(a.customHeight));
    setError(null);
  }, [a.customWidth, a.customHeight]);

  const commit = (w: string, h: string): void => {
    const r = validateCustomSize(w, h);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    if (r.width !== a.customWidth || r.height !== a.customHeight) {
      onChange({ ...value, aspect: { ...a, customWidth: r.width, customHeight: r.height } });
    }
  };

  const out = outputSize(a, sourceSize);
  const sizeInput = (
    label: string,
    v: string,
    setV: (s: string) => void,
    other: string,
    isW: boolean,
  ): ReactElement => (
    <input
      aria-label={label}
      inputMode="numeric"
      value={v}
      aria-invalid={error !== null}
      onChange={(e) => {
        setV(e.target.value);
        commit(isW ? e.target.value : other, isW ? other : e.target.value);
      }}
      style={{
        ...mono,
        width: "72px",
        background: "var(--bg-sunken)",
        color: "var(--text-1)",
        border: `1px solid ${error ? "var(--danger)" : "var(--border-strong)"}`,
        borderRadius: "var(--radius-sm)",
        padding: "2px var(--space-1)",
      }}
    />
  );

  return (
    <div style={stack}>
      <Segmented
        name={`${name}-aspect`}
        value={a.preset}
        options={ASPECT_OPTIONS}
        onChange={(preset) => onChange({ ...value, aspect: { ...a, preset } })}
      />
      {a.preset === "custom" && (
        <div style={stack} role="group" aria-label="Custom size">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
            {sizeInput("Custom width", draftW, setDraftW, draftH, true)}
            <span style={{ color: "var(--text-3)" }}>×</span>
            {sizeInput("Custom height", draftH, setDraftH, draftW, false)}
            <span style={hint}>px</span>
          </div>
          {error && (
            <span role="alert" style={{ ...hint, color: "var(--danger)" }}>
              {error}
            </span>
          )}
        </div>
      )}
      <span style={hint}>
        Output <span style={mono} data-testid="output-size">{`${out.width} × ${out.height}`}</span>
        {a.preset === "source" && !sourceSize && " (source size unknown)"}
      </span>
    </div>
  );
}
