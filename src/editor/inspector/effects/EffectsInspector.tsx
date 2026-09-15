import { Button, Input, Segmented } from "@design/components";
import { type CSSProperties, type ReactElement, useState } from "react";
import { ColorField, EmptyState, NumberField, Section, Slider, Switch } from "../controls";
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

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: "0 var(--space-3)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
};

const toolRowStyle: CSSProperties = { display: "flex", gap: "var(--space-2)", flexWrap: "wrap" };
const subheadStyle: CSSProperties = { fontSize: "12px", color: "var(--text-2)" };

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
    <div style={rootStyle} aria-label={t("inspector.effects.label")}>
      <Section title={t("inspector.common.speed")}>
        {region ? (
          <>
            <Slider
              label={t("inspector.common.speed")}
              value={region.rate}
              min={L.speedRate.min}
              max={L.speedRate.max}
              step={0.25}
              unit="×"
              onChange={(rate) => onSpeedRegionChange(updateSpeedRegion(region, { rate }))}
            />
            <Switch
              label={t("inspector.effects.keepPitch")}
              checked={region.keepPitch}
              onChange={(keepPitch) =>
                onSpeedRegionChange(updateSpeedRegion(region, { keepPitch }))
              }
            />
            <NumberField
              label={t("inspector.effects.rampIn")}
              value={region.rampInMs}
              min={0}
              max={rampMax}
              step={50}
              unit="ms"
              onChange={(rampInMs) => onSpeedRegionChange(updateSpeedRegion(region, { rampInMs }))}
            />
            <NumberField
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
          </>
        ) : (
          <EmptyState title={t("inspector.effects.noSpeed.title")}>
            {t("inspector.effects.noSpeed.body")}
          </EmptyState>
        )}
        <div style={toolRowStyle}>
          <Button onClick={() => setSilenceOpen(true)} disabled={envelope === null}>
            {t("inspector.effects.removeSilenceButton")}
          </Button>
          <Button onClick={runAutoIdle} disabled={!hasCursor}>
            {t("inspector.effects.autoIdle")}
          </Button>
        </div>
        {idleNotice && (
          <div role="status" style={subheadStyle}>
            {idleNotice}
          </div>
        )}
      </Section>

      <Section title={t("inspector.effects.transitions")}>
        <Segmented
          name="effects-transition"
          value={value.transition.kind}
          options={TRANSITION_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onChange={(kind) => set("transition", { ...value.transition, kind })}
        />
        <NumberField
          label={t("inspector.common.duration")}
          value={value.transition.durationMs}
          min={L.transitionMs.min}
          max={L.transitionMs.max}
          step={50}
          unit="ms"
          disabled={value.transition.kind === "none"}
          onChange={(durationMs) => set("transition", { ...value.transition, durationMs })}
        />
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
          onChange={(brightness) => setColor({ brightness })}
        />
        <Slider
          label={t("inspector.effects.contrast")}
          value={value.color.contrast}
          min={L.colorAdjust.min}
          max={L.colorAdjust.max}
          onChange={(contrast) => setColor({ contrast })}
        />
        <Slider
          label={t("inspector.effects.saturation")}
          value={value.color.saturation}
          min={L.colorAdjust.min}
          max={L.colorAdjust.max}
          onChange={(saturation) => setColor({ saturation })}
        />
        <Switch
          label={t("inspector.effects.grain")}
          hint={t("inspector.effects.grain.hint")}
          checked={value.color.grain}
          onChange={(grain) => setColor({ grain })}
        />
        <Slider
          label={t("inspector.effects.vignette")}
          value={value.color.vignette}
          min={L.vignette.min}
          max={L.vignette.max}
          unit="%"
          onChange={(vignette) => setColor({ vignette })}
        />
      </Section>

      <Section title={t("inspector.common.motion")}>
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
      </Section>

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

interface TitleCardEditorProps {
  kind: keyof typeof TITLE_CARD_KEYS;
  card: TitleCard | null;
  onChange: (card: TitleCard | null) => void;
}

function TitleCardEditor({ kind, card, onChange }: TitleCardEditorProps): ReactElement {
  const t = useInspectorT();
  const keys = TITLE_CARD_KEYS[kind];
  const L = EFFECTS_LIMITS;
  if (!card) {
    return (
      <Button onClick={() => onChange({ ...DEFAULT_TITLE_CARD })} aria-label={t(keys.addLabel)}>
        {t(keys.add)}
      </Button>
    );
  }
  return (
    <div
      role="group"
      aria-label={t(keys.group)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-2)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={subheadStyle}>{t(keys.name)}</span>
        <Button variant="ghost" onClick={() => onChange(null)} aria-label={t(keys.removeLabel)}>
          {t("inspector.common.remove")}
        </Button>
      </div>
      <Input
        label={t(keys.text)}
        value={card.text}
        onChange={(e) => onChange({ ...card, text: e.target.value })}
      />
      <ColorField
        label={t(keys.background)}
        value={card.bg}
        onChange={(bg) => onChange({ ...card, bg })}
      />
      <NumberField
        label={t(keys.duration)}
        value={card.durationMs}
        min={L.titleCardMs.min}
        max={L.titleCardMs.max}
        step={100}
        unit="ms"
        onChange={(durationMs) => onChange({ ...card, durationMs })}
      />
    </div>
  );
}
