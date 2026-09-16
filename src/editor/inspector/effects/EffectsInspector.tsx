import { Button } from "@design/components";
import { type CSSProperties, type ReactElement, useId, useState } from "react";
import {
  Callout,
  ChoiceRow,
  ColorField,
  FieldRow,
  NumberField,
  Section,
  Slider,
  Switch,
  clamp,
  hintStyle,
  inspectorRootStyle,
  useInspectorControlStyles,
  valueBoxStyle,
} from "../controls";
import { type InspectorMessageKey, useInspectorT } from "../i18n";
import { RemoveSilenceDialog } from "./RemoveSilenceDialog";
import { detectIdleSections, maxRampMs, suggestIdleSpeedRegions, updateSpeedRegion } from "./logic";
import {
  type AudioEnvelope,
  type CursorSample,
  DEFAULT_TITLE_CARD,
  EFFECTS_LIMITS,
  type EffectsSettings,
  type SilenceParams,
  type SpeedRegionEdit,
  type TimeRange,
  type TitleCard,
  type TransitionKind,
} from "./types";

export interface EffectsInspectorProps {
  value: EffectsSettings;
  onChange: (next: EffectsSettings) => void;
  /** Speed region selected on the timeline, or `null`. */
  selectedSpeedRegion: SpeedRegionEdit | null;
  onSpeedRegionChange: (next: SpeedRegionEdit) => void;
  /** Audio envelope for "Remove silence"; `null` disables the tool. */
  envelope: AudioEnvelope | null;
  onApplyRemoveSilence: (gaps: TimeRange[], params: SilenceParams) => void;
  /** Cursor telemetry for "Auto speed-up idle"; `null`/empty disables the tool. */
  cursorSamples: readonly CursorSample[] | null;
  onAutoSpeedIdle: (regions: SpeedRegionEdit[]) => void;
  /** Open the remove-silence dialog on mount (state rendering). */
  initialRemoveSilenceOpen?: boolean | undefined;
}

const TRANSITION_OPTIONS: ReadonlyArray<{ value: TransitionKind; labelKey: InspectorMessageKey }> =
  [
    { value: "none", labelKey: "inspector.common.none" },
    { value: "cross-dissolve", labelKey: "inspector.effects.transition.crossDissolve" },
    { value: "cut-with-zoom", labelKey: "inspector.effects.transition.cutWithZoom" },
  ];

/** Labels for the Intro / Outro title-card editors. */
const TITLE_CARD_KEYS = {
  intro: {
    name: "inspector.effects.intro",
    add: "inspector.effects.intro.add",
    addLabel: "inspector.effects.intro.addLabel",
    group: "inspector.effects.intro.group",
    removeLabel: "inspector.effects.intro.removeLabel",
    text: "inspector.effects.intro.text",
    background: "inspector.effects.intro.background",
    duration: "inspector.effects.intro.duration",
  },
  outro: {
    name: "inspector.effects.outro",
    add: "inspector.effects.outro.add",
    addLabel: "inspector.effects.outro.addLabel",
    group: "inspector.effects.outro.group",
    removeLabel: "inspector.effects.outro.removeLabel",
    text: "inspector.effects.outro.text",
    background: "inspector.effects.outro.background",
    duration: "inspector.effects.outro.duration",
  },
} as const satisfies Record<string, Record<string, InspectorMessageKey>>;

/** Secondary pill that shares its row (design: 12px, flex 1). */
const pillStyle: CSSProperties = { flex: "1 1 0", minWidth: 0, fontSize: "12px" };

/** Signed colour offset readout: "+4", "0", "-8". */
const signed = (v: number): string => (v > 0 ? `+${v}` : `${v}`);

/** Inspector tab S20 — speed, transitions, intro/outro, color, motion. */
export function EffectsInspector({
  value,
  onChange,
  selectedSpeedRegion,
  onSpeedRegionChange,
  envelope,
  onApplyRemoveSilence,
  cursorSamples,
  onAutoSpeedIdle,
  initialRemoveSilenceOpen = false,
}: EffectsInspectorProps): ReactElement {
  const t = useInspectorT();
  const [silenceOpen, setSilenceOpen] = useState(initialRemoveSilenceOpen);
  const [idleNotice, setIdleNotice] = useState<string | null>(null);
  const L = EFFECTS_LIMITS;
  const set = <K extends keyof EffectsSettings>(key: K, v: EffectsSettings[K]) =>
    onChange({ ...value, [key]: v });
  const setColor = (patch: Partial<EffectsSettings["color"]>) =>
    set("color", { ...value.color, ...patch });
  const setMotion = (patch: Partial<EffectsSettings["motion"]>) =>
    set("motion", { ...value.motion, ...patch });
  const hasCursor = cursorSamples !== null && cursorSamples.length > 1;

  const runAutoIdle = () => {
    if (!cursorSamples) return;
    const regions = suggestIdleSpeedRegions(detectIdleSections(cursorSamples));
    if (regions.length === 0) {
      setIdleNotice(t("inspector.effects.noIdle"));
      return;
    }
    setIdleNotice(null);
    onAutoSpeedIdle(regions);
  };

  const region = selectedSpeedRegion;
  const rampMax = region ? Math.floor(maxRampMs(region)) : 0;

  return (
    <div style={inspectorRootStyle} aria-label={t("inspector.effects.label")}>
      <Section title={t("inspector.effects.speedRegion")}>
        {region ? (
          <>
            <Slider
              label={t("inspector.common.speed")}
              value={region.rate}
              min={L.speedRate.min}
              max={L.speedRate.max}
              step={0.25}
              unit="×"
              labelWidth={52}
              onChange={(rate) => onSpeedRegionChange(updateSpeedRegion(region, { rate }))}
            />
            <Switch
              label={t("inspector.effects.keepPitch")}
              checked={region.keepPitch}
              onChange={(keepPitch) =>
                onSpeedRegionChange(updateSpeedRegion(region, { keepPitch }))
              }
            />
            <FieldRow>
              <NumberField
                inline
                label={t("inspector.effects.rampIn")}
                value={region.rampInMs}
                min={0}
                max={rampMax}
                step={50}
                unit="ms"
                onChange={(rampInMs) =>
                  onSpeedRegionChange(updateSpeedRegion(region, { rampInMs }))
                }
              />
              <NumberField
                inline
                label={t("inspector.effects.rampOut")}
                value={region.rampOutMs}
                min={0}
                max={rampMax}
                step={50}
                unit="ms"
                onChange={(rampOutMs) =>
                  onSpeedRegionChange(updateSpeedRegion(region, { rampOutMs }))
                }
              />
            </FieldRow>
          </>
        ) : (
          <Callout tone="neutral" role="status" title={t("inspector.effects.noSpeed.title")}>
            {t("inspector.effects.noSpeed.body")}
          </Callout>
        )}
      </Section>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "-4px" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button
            style={pillStyle}
            onClick={() => setSilenceOpen(true)}
            disabled={envelope === null}
          >
            {t("inspector.effects.removeSilenceButton")}
          </Button>
          <Button style={pillStyle} onClick={runAutoIdle} disabled={!hasCursor}>
            {t("inspector.effects.autoIdle")}
          </Button>
        </div>
        {idleNotice && (
          <div role="status" style={hintStyle}>
            {idleNotice}
          </div>
        )}
      </div>

      <Section title={t("inspector.effects.transitions")}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <ChoiceRow
            label={t("inspector.effects.transitions")}
            value={value.transition.kind}
            options={TRANSITION_OPTIONS.map((o) => {
              const label = t(o.labelKey);
              return { value: o.value, label, ariaLabel: label };
            })}
            onChange={(kind) => set("transition", { ...value.transition, kind })}
          />
          <MsBox
            label={t("inspector.common.duration")}
            value={value.transition.durationMs}
            min={L.transitionMs.min}
            max={L.transitionMs.max}
            step={50}
            disabled={value.transition.kind === "none"}
            onChange={(durationMs) => set("transition", { ...value.transition, durationMs })}
          />
        </div>
      </Section>

      <Section title={t("inspector.effects.introOutro")}>
        <TitleCardEditor
          kind="intro"
          card={value.intro}
          onChange={(intro) => set("intro", intro)}
        />
        <TitleCardEditor
          kind="outro"
          card={value.outro}
          onChange={(outro) => set("outro", outro)}
        />
      </Section>

      <Section title={t("inspector.common.color")}>
        <Slider
          label={t("inspector.effects.brightness")}
          value={value.color.brightness}
          min={L.colorAdjust.min}
          max={L.colorAdjust.max}
          labelWidth={62}
          format={signed}
          onChange={(brightness) => setColor({ brightness })}
        />
        <Slider
          label={t("inspector.effects.contrast")}
          value={value.color.contrast}
          min={L.colorAdjust.min}
          max={L.colorAdjust.max}
          labelWidth={62}
          format={signed}
          onChange={(contrast) => setColor({ contrast })}
        />
        <Slider
          label={t("inspector.effects.saturation")}
          value={value.color.saturation}
          min={L.colorAdjust.min}
          max={L.colorAdjust.max}
          labelWidth={62}
          format={signed}
          onChange={(saturation) => setColor({ saturation })}
        />
        <Slider
          label={t("inspector.effects.vignette")}
          value={value.color.vignette}
          min={L.vignette.min}
          max={L.vignette.max}
          unit="%"
          labelWidth={62}
          onChange={(vignette) => setColor({ vignette })}
        />
        <Switch
          label={t("inspector.effects.grain")}
          hint={t("inspector.effects.grain.hint")}
          checked={value.color.grain}
          onChange={(grain) => setColor({ grain })}
        />
      </Section>

      <div
        role="group"
        aria-label={t("inspector.common.motion")}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "9px",
          paddingTop: "8px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <Switch
          label={t("inspector.effects.tilt")}
          checked={value.motion.tilt3d}
          onChange={(tilt3d) => setMotion({ tilt3d })}
        />
        <Switch
          label={t("inspector.effects.parallax")}
          checked={value.motion.parallax}
          onChange={(parallax) => setMotion({ parallax })}
        />
      </div>

      {silenceOpen && (
        <RemoveSilenceDialog
          open
          onClose={() => setSilenceOpen(false)}
          envelope={envelope}
          onApply={onApplyRemoveSilence}
        />
      )}
    </div>
  );
}

interface MsBoxProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean | undefined;
  onChange: (value: number) => void;
}

/** Right-aligned sunken mono "280 ms" field; the label is for AT only. */
function MsBox({ label, value, min, max, step, disabled, onChange }: MsBoxProps): ReactElement {
  useInspectorControlStyles();
  return (
    <span
      className="rf-valuebox"
      style={{
        ...valueBoxStyle,
        display: "flex",
        alignItems: "center",
        gap: "4px",
        width: "76px",
        marginLeft: "auto",
        color: "var(--text-2)",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value === "" || !Number.isFinite(n)) return;
          onChange(clamp(n, min, max));
        }}
      />
      <span style={{ color: "var(--text-3)" }}>ms</span>
    </span>
  );
}

interface TitleCardEditorProps {
  kind: keyof typeof TITLE_CARD_KEYS;
  card: TitleCard | null;
  onChange: (card: TitleCard | null) => void;
}

function TitleCardEditor({ kind, card, onChange }: TitleCardEditorProps): ReactElement {
  const t = useInspectorT();
  const textId = useId();
  const keys = TITLE_CARD_KEYS[kind];
  const L = EFFECTS_LIMITS;
  if (!card) {
    return (
      <Button
        block
        style={{ fontSize: "12px" }}
        onClick={() => onChange({ ...DEFAULT_TITLE_CARD })}
        aria-label={t(keys.addLabel)}
      >
        {t(keys.add)}
      </Button>
    );
  }
  return (
    <div
      role="group"
      aria-label={t(keys.group)}
      style={{
        padding: "10px",
        borderRadius: "12px",
        background: "var(--bg-panel-raised)",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <div
          aria-hidden="true"
          style={{
            flex: "0 0 auto",
            width: "52px",
            height: "30px",
            borderRadius: "6px",
            // User-chosen card background (content colour, not chrome).
            background: card.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            padding: "0 3px",
            boxSizing: "border-box",
            fontSize: "8px",
            color: "var(--text-1)",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{card.text}</span>
        </div>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div style={{ fontSize: "12px", fontWeight: 600 }}>{t(keys.name)}</div>
          <div
            style={{
              color: "var(--text-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {card.text ? `“${card.text}” · ` : ""}
            {(card.durationMs / 1000).toFixed(1)} s
          </div>
        </div>
        <button
          type="button"
          className="rf-choice"
          onClick={() => onChange(null)}
          aria-label={t(keys.removeLabel)}
          style={{
            appearance: "none",
            border: 0,
            background: "transparent",
            padding: "4px 6px",
            borderRadius: "8px",
            cursor: "pointer",
            fontFamily: "var(--font-body)",
            fontSize: "11px",
            color: "var(--text-3)",
          }}
        >
          {t("inspector.common.remove")}
        </button>
      </div>
      <input
        id={textId}
        type="text"
        aria-label={t(keys.text)}
        value={card.text}
        onChange={(e) => onChange({ ...card, text: e.target.value })}
        style={{
          ...valueBoxStyle,
          width: "100%",
          fontFamily: "var(--font-body)",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <ColorField
          hideLabel
          label={t(keys.background)}
          value={card.bg}
          onChange={(bg) => onChange({ ...card, bg })}
        />
        <div style={{ marginLeft: "auto", display: "flex", width: "104px" }}>
          <NumberField
            inline
            label={t(keys.duration)}
            value={card.durationMs}
            min={L.titleCardMs.min}
            max={L.titleCardMs.max}
            step={100}
            unit="ms"
            onChange={(durationMs) => onChange({ ...card, durationMs })}
          />
        </div>
      </div>
    </div>
  );
}
