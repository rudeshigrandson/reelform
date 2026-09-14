import { useState, type CSSProperties, type ReactElement } from "react";
import { Button, Input, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { ColorField, EmptyState, NumberField, Section, Slider, Switch } from "../controls";
import { detectIdleSections, maxRampMs, suggestIdleSpeedRegions, updateSpeedRegion } from "./logic";
import { RemoveSilenceDialog } from "./RemoveSilenceDialog";
import {
  DEFAULT_TITLE_CARD,
  EFFECTS_LIMITS,
  type AudioEnvelope,
  type CursorSample,
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

const TRANSITION_OPTIONS: ReadonlyArray<SegmentedOption<TransitionKind>> = [
  { value: "none", label: "None" },
  { value: "cross-dissolve", label: "Cross-dissolve" },
  { value: "cut-with-zoom", label: "Cut-with-zoom" },
];

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: "0 var(--space-3)",
  color: "var(--color-neutral-100)",
  fontFamily: "var(--font-body)",
};

const toolRowStyle: CSSProperties = { display: "flex", gap: "var(--space-2)", flexWrap: "wrap" };
const subheadStyle: CSSProperties = { fontSize: "12px", color: "var(--color-neutral-400)" };

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
  const [silenceOpen, setSilenceOpen] = useState(initialRemoveSilenceOpen);
  const [idleNotice, setIdleNotice] = useState<string | null>(null);
  const L = EFFECTS_LIMITS;
  const set = <K extends keyof EffectsSettings>(key: K, v: EffectsSettings[K]) => onChange({ ...value, [key]: v });
  const setColor = (patch: Partial<EffectsSettings["color"]>) => set("color", { ...value.color, ...patch });
  const setMotion = (patch: Partial<EffectsSettings["motion"]>) => set("motion", { ...value.motion, ...patch });
  const hasCursor = cursorSamples !== null && cursorSamples.length > 1;

  const runAutoIdle = () => {
    if (!cursorSamples) return;
    const regions = suggestIdleSpeedRegions(detectIdleSections(cursorSamples));
    if (regions.length === 0) {
      setIdleNotice("No idle sections found");
      return;
    }
    setIdleNotice(null);
    onAutoSpeedIdle(regions);
  };

  const region = selectedSpeedRegion;
  const rampMax = region ? Math.floor(maxRampMs(region)) : 0;

  return (
    <div style={rootStyle} aria-label="Effects inspector">
      <Section title="Speed">
        {region ? (
          <>
            <Slider
              label="Speed"
              value={region.rate}
              min={L.speedRate.min}
              max={L.speedRate.max}
              step={0.25}
              unit="×"
              onChange={(rate) => onSpeedRegionChange(updateSpeedRegion(region, { rate }))}
            />
            <Switch
              label="Keep pitch"
              checked={region.keepPitch}
              onChange={(keepPitch) => onSpeedRegionChange(updateSpeedRegion(region, { keepPitch }))}
            />
            <NumberField
              label="Ramp in"
              value={region.rampInMs}
              min={0}
              max={rampMax}
              step={50}
              unit="ms"
              onChange={(rampInMs) => onSpeedRegionChange(updateSpeedRegion(region, { rampInMs }))}
            />
            <NumberField
              label="Ramp out"
              value={region.rampOutMs}
              min={0}
              max={rampMax}
              step={50}
              unit="ms"
              onChange={(rampOutMs) => onSpeedRegionChange(updateSpeedRegion(region, { rampOutMs }))}
            />
          </>
        ) : (
          <EmptyState title="No speed region selected">Select a speed region on the timeline to edit it.</EmptyState>
        )}
        <div style={toolRowStyle}>
          <Button onClick={() => setSilenceOpen(true)} disabled={envelope === null}>
            Remove silence…
          </Button>
          <Button onClick={runAutoIdle} disabled={!hasCursor}>
            Auto speed-up idle
          </Button>
        </div>
        {idleNotice && (
          <div role="status" style={subheadStyle}>
            {idleNotice}
          </div>
        )}
      </Section>

      <Section title="Transitions">
        <Segmented
          name="effects-transition"
          value={value.transition.kind}
          options={TRANSITION_OPTIONS}
          onChange={(kind) => set("transition", { ...value.transition, kind })}
        />
        <NumberField
          label="Duration"
          value={value.transition.durationMs}
          min={L.transitionMs.min}
          max={L.transitionMs.max}
          step={50}
          unit="ms"
          disabled={value.transition.kind === "none"}
          onChange={(durationMs) => set("transition", { ...value.transition, durationMs })}
        />
      </Section>

      <Section title="Intro / Outro">
        <TitleCardEditor label="Intro" card={value.intro} onChange={(intro) => set("intro", intro)} />
        <TitleCardEditor label="Outro" card={value.outro} onChange={(outro) => set("outro", outro)} />
      </Section>

      <Section title="Color">
        <Slider
          label="Brightness"
          value={value.color.brightness}
          min={L.colorAdjust.min}
          max={L.colorAdjust.max}
          onChange={(brightness) => setColor({ brightness })}
        />
        <Slider
          label="Contrast"
          value={value.color.contrast}
          min={L.colorAdjust.min}
          max={L.colorAdjust.max}
          onChange={(contrast) => setColor({ contrast })}
        />
        <Slider
          label="Saturation"
          value={value.color.saturation}
          min={L.colorAdjust.min}
          max={L.colorAdjust.max}
          onChange={(saturation) => setColor({ saturation })}
        />
        <Switch label="Grain" hint="Subtle" checked={value.color.grain} onChange={(grain) => setColor({ grain })} />
        <Slider
          label="Vignette"
          value={value.color.vignette}
          min={L.vignette.min}
          max={L.vignette.max}
          unit="%"
          onChange={(vignette) => setColor({ vignette })}
        />
      </Section>

      <Section title="Motion">
        <Switch
          label="Subtle 3D tilt on zooms"
          checked={value.motion.tilt3d}
          onChange={(tilt3d) => setMotion({ tilt3d })}
        />
        <Switch
          label="Parallax background"
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
  label: "Intro" | "Outro";
  card: TitleCard | null;
  onChange: (card: TitleCard | null) => void;
}

function TitleCardEditor({ label, card, onChange }: TitleCardEditorProps): ReactElement {
  const L = EFFECTS_LIMITS;
  if (!card) {
    return (
      <Button onClick={() => onChange({ ...DEFAULT_TITLE_CARD })} aria-label={`Add ${label.toLowerCase()} title card`}>
        + Add {label.toLowerCase()} title card
      </Button>
    );
  }
  return (
    <div
      role="group"
      aria-label={`${label} title card`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-2)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-neutral-800)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={subheadStyle}>{label}</span>
        <Button variant="ghost" onClick={() => onChange(null)} aria-label={`Remove ${label.toLowerCase()} title card`}>
          Remove
        </Button>
      </div>
      <Input
        label={`${label} text`}
        value={card.text}
        onChange={(e) => onChange({ ...card, text: e.target.value })}
      />
      <ColorField label={`${label} background`} value={card.bg} onChange={(bg) => onChange({ ...card, bg })} />
      <NumberField
        label={`${label} duration`}
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
