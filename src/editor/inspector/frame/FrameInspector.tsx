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
import { type InspectorMessageKey, useInspectorT } from "../i18n";
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

const BACKGROUND_OPTIONS: ReadonlyArray<{ value: BackgroundKind; labelKey: InspectorMessageKey }> =
  [
    { value: "wallpaper", labelKey: "inspector.frame.bg.wallpaper" },
    { value: "color", labelKey: "inspector.common.color" },
    { value: "gradient", labelKey: "inspector.frame.bg.gradient" },
    { value: "image", labelKey: "inspector.common.image" },
    { value: "none", labelKey: "inspector.common.none" },
  ];

/** Ratio presets are shown as-is; `source` / `custom` are words. */
const ASPECT_OPTIONS: ReadonlyArray<{ value: AspectPreset; labelKey?: InspectorMessageKey }> = [
  { value: "16:9" },
  { value: "9:16" },
  { value: "1:1" },
  { value: "4:3" },
  { value: "4:5" },
  { value: "21:9" },
  { value: "source", labelKey: "inspector.common.source" },
  { value: "custom", labelKey: "inspector.common.custom" },
];

const SECTION_TITLE_KEYS: Readonly<Record<FrameSectionId, InspectorMessageKey>> = {
  background: "inspector.common.background",
  blur: "inspector.common.blur",
  padding: "inspector.common.padding",
  radius: "inspector.common.cornerRadius",
  shadow: "inspector.common.shadow",
  border: "inspector.common.border",
  aspect: "inspector.frame.section.aspect",
  inset: "inspector.frame.section.inset",
};

/** Bundled preset names; user presets keep the name they were saved with. */
const BUILT_IN_PRESET_NAME_KEYS: Readonly<Record<string, InspectorMessageKey>> = {
  default: "inspector.frame.preset.default",
  minimal: "inspector.frame.preset.minimal",
  "product-hunt": "inspector.frame.preset.productHunt",
  twitter: "inspector.frame.preset.twitter",
  vertical: "inspector.frame.preset.vertical",
};

const CATEGORY_KEYS: Readonly<Record<WallpaperCategory, InspectorMessageKey>> = {
  Abstract: "inspector.frame.category.abstract",
  Gradient: "inspector.frame.category.gradient",
  Mesh: "inspector.frame.category.mesh",
  Mac: "inspector.frame.category.mac",
  Solid: "inspector.frame.category.solid",
  Custom: "inspector.common.custom",
};

const PADDING_SIDES: ReadonlyArray<[PaddingSide, InspectorMessageKey]> = [
  ["top", "inspector.frame.side.top"],
  ["right", "inspector.frame.side.right"],
  ["bottom", "inspector.frame.side.bottom"],
  ["left", "inspector.frame.side.left"],
];

export function FrameInspector(props: FrameInspectorProps): ReactElement {
  const t = useInspectorT();
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
      aria-label={t("inspector.frame.label")}
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
            label={t("inspector.frame.backgroundBlur")}
            value={value.blur}
            min={FRAME_LIMITS.blur.min}
            max={FRAME_LIMITS.blur.max}
            unit="px"
            disabled={!blurApplies}
            onChange={(blur) => set({ blur })}
          />
          {!blurApplies && <span style={hint}>{t("inspector.frame.blurHint")}</span>}
        </>,
      )}

      {section(
        "padding",
        <>
          <Slider
            label={t("inspector.common.padding")}
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
            label={t("inspector.frame.matchAll")}
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
              {PADDING_SIDES.map(([side, labelKey]) => (
                <NumberField
                  key={side}
                  label={t(labelKey)}
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
            label={t("inspector.common.cornerRadius")}
            value={value.radius}
            min={FRAME_LIMITS.radius.min}
            max={FRAME_LIMITS.radius.max}
            unit="px"
            onChange={(radius) => set({ radius })}
          />
          <Switch
            label={t("inspector.frame.squircle")}
            checked={value.squircle}
            onChange={(squircle) => set({ squircle })}
          />
        </>,
      )}

      {section(
        "shadow",
        <>
          <Slider
            label={t("inspector.common.strength")}
            value={value.shadow.strength}
            min={FRAME_LIMITS.shadowStrength.min}
            max={FRAME_LIMITS.shadowStrength.max}
            onChange={(strength) => set({ shadow: { ...value.shadow, strength } })}
          />
          <Slider
            label={t("inspector.frame.offsetY")}
            value={value.shadow.offsetY}
            min={FRAME_LIMITS.shadowOffsetY.min}
            max={FRAME_LIMITS.shadowOffsetY.max}
            unit="px"
            onChange={(offsetY) => set({ shadow: { ...value.shadow, offsetY } })}
          />
          <Slider
            label={t("inspector.frame.shadowBlur")}
            value={value.shadow.blur}
            min={FRAME_LIMITS.shadowBlur.min}
            max={FRAME_LIMITS.shadowBlur.max}
            unit="px"
            onChange={(blur) => set({ shadow: { ...value.shadow, blur } })}
          />
          <ColorField
            label={t("inspector.frame.shadowColor")}
            value={value.shadow.color}
            onChange={(color) => set({ shadow: { ...value.shadow, color } })}
          />
        </>,
      )}

      {section(
        "border",
        <>
          <Slider
            label={t("inspector.common.width")}
            value={value.border.width}
            min={FRAME_LIMITS.borderWidth.min}
            max={FRAME_LIMITS.borderWidth.max}
            unit="px"
            onChange={(width) => set({ border: { ...value.border, width } })}
          />
          <ColorField
            label={t("inspector.common.borderColor")}
            value={value.border.color}
            onChange={(color) => set({ border: { ...value.border, color } })}
          />
          <Slider
            label={t("inspector.common.opacity")}
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
            label={t("inspector.frame.sourceScale")}
            value={value.inset}
            min={FRAME_LIMITS.inset.min}
            max={FRAME_LIMITS.inset.max}
            unit="%"
            onChange={(inset) => set({ inset })}
          />
          <span style={hint}>{t("inspector.frame.insetHint")}</span>
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
  const t = useInspectorT();
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
      <Section title={t(SECTION_TITLE_KEYS[id])} defaultOpen={!collapsed}>
        {children}
      </Section>
    </div>
  );
}

function presetName(p: FramePreset, t: ReturnType<typeof useInspectorT>): string {
  const key = p.builtIn ? BUILT_IN_PRESET_NAME_KEYS[p.id] : undefined;
  return key ? t(key) : p.name;
}

function PresetsRow({
  value,
  onChange,
  userPresets,
  onSavePreset,
}: FrameInspectorProps): ReactElement {
  const t = useInspectorT();
  const all = [...BUILT_IN_FRAME_PRESETS, ...(userPresets ?? [])];
  const active = findMatchingPreset(value, all);
  return (
    <div
      role="group"
      aria-label={t("inspector.frame.presets")}
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
            {presetName(p, t)}
          </button>
        ))}
      </div>
      <Button variant="ghost" disabled={!onSavePreset} onClick={() => onSavePreset?.()}>
        {t("inspector.frame.savePreset")}
      </Button>
    </div>
  );
}

function BackgroundEditor(props: FrameInspectorProps): ReactElement {
  const t = useInspectorT();
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
        options={BACKGROUND_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
        onChange={(kind) => setBg({ kind })}
      />
      {bg.kind === "wallpaper" && <WallpaperGrid {...props} />}
      {bg.kind === "color" && (
        <ColorField
          label={t("inspector.frame.backgroundColor")}
          value={bg.color}
          onChange={(color) => setBg({ color })}
        />
      )}
      {bg.kind === "gradient" && <GradientEditor {...props} />}
      {bg.kind === "image" && <ImagePanel {...props} />}
      {bg.kind === "none" && <span style={hint}>{t("inspector.frame.transparentHint")}</span>}
    </div>
  );
}

function WallpaperGrid({
  value,
  onChange,
  wallpapers,
  onAddCustomWallpaper,
}: FrameInspectorProps): ReactElement {
  const t = useInspectorT();
  const list = wallpapers ?? PLACEHOLDER_WALLPAPERS;
  const selected = list.find((w) => w.id === value.background.wallpaperId);
  const [category, setCategory] = useState<WallpaperCategory>(selected?.category ?? "Abstract");
  const shown = list.filter((w) => w.category === category);
  return (
    <div style={stack}>
      <div
        role="group"
        aria-label={t("inspector.frame.wallpaperCategories")}
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
            {t(CATEGORY_KEYS[c])}
          </button>
        ))}
      </div>
      <div
        role="listbox"
        aria-label={t("inspector.frame.wallpapers")}
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
            {t("inspector.frame.addCustom")}
          </button>
        )}
      </div>
      {shown.length === 0 && !onAddCustomWallpaper && (
        <span style={hint}>{t("inspector.frame.noWallpapers")}</span>
      )}
    </div>
  );
}

function GradientEditor({ value, onChange }: FrameInspectorProps): ReactElement {
  const t = useInspectorT();
  const name = useId();
  const g = value.background.gradient;
  const setG = (gradient: FrameSettings["background"]["gradient"]): void =>
    onChange({ ...value, background: { ...value.background, gradient } });
  const { min, max } = FRAME_LIMITS.gradientStops;
  return (
    <div style={stack} aria-label={t("inspector.frame.gradientEditor")} role="group">
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
          { value: "linear", label: t("inspector.frame.gradient.linear") },
          { value: "radial", label: t("inspector.frame.gradient.radial") },
        ]}
        onChange={(type) => setG({ ...g, type })}
      />
      {g.type === "linear" && (
        <Slider
          label={t("inspector.frame.angle")}
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
              label={t("inspector.frame.stopColor", { n: i + 1 })}
              value={s.color}
              onChange={(color) => setG(updateGradientStop(g, i, { color }))}
            />
            <Slider
              label={t("inspector.frame.stopPosition", { n: i + 1 })}
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
            aria-label={t("inspector.frame.removeStop", { n: i + 1 })}
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
        {t("inspector.frame.addStop")}
      </Button>
    </div>
  );
}

function ImagePanel({ value, onChange, onImageSelect }: FrameInspectorProps): ReactElement {
  const t = useInspectorT();
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
                {t("inspector.frame.image.replace")}
              </label>
              <Button variant="ghost" onClick={() => setImg({ path: null })}>
                {t("inspector.common.remove")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <span>
              {hover ? t("inspector.frame.image.dropToUse") : t("inspector.frame.image.dropHere")}
            </span>
            <label htmlFor={inputId} className="btn btn-ghost" style={{ cursor: "pointer" }}>
              {t("inspector.frame.image.browse")}
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
          { value: "fit", label: t("inspector.common.fit") },
          { value: "fill", label: t("inspector.common.fill") },
        ]}
        onChange={(fit) => setImg({ fit })}
      />
    </div>
  );
}

function AspectEditor({ value, onChange, sourceSize }: FrameInspectorProps): ReactElement {
  const t = useInspectorT();
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
        options={ASPECT_OPTIONS.map((o) => ({
          value: o.value,
          label: o.labelKey ? t(o.labelKey) : o.value,
        }))}
        onChange={(preset) => onChange({ ...value, aspect: { ...a, preset } })}
      />
      {a.preset === "custom" && (
        <div style={stack} role="group" aria-label={t("inspector.frame.customSize")}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
            {sizeInput(t("inspector.frame.customWidth"), draftW, setDraftW, draftH, true)}
            <span style={{ color: "var(--text-3)" }}>×</span>
            {sizeInput(t("inspector.frame.customHeight"), draftH, setDraftH, draftW, false)}
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
        {t("inspector.frame.output")}{" "}
        <span style={mono} data-testid="output-size">{`${out.width} × ${out.height}`}</span>
        {a.preset === "source" && !sourceSize && ` ${t("inspector.frame.sourceUnknown")}`}
      </span>
    </div>
  );
}
