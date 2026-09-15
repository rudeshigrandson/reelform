import { Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { useId } from "react";
import { type MessageKey, useT } from "../../i18n";
import {
  NumberField,
  PageHeading,
  Row,
  Select,
  type SelectOption,
  Switch,
  labelStyle,
} from "../controls";
import type { DefaultAspect, PreviewQuality, SettingsProps } from "../types";

/** Built-in frame preset ids (src/editor/inspector/frame BUILT_IN_FRAME_PRESETS). */
const FRAME_PRESETS: ReadonlyArray<{ value: string; labelKey: MessageKey }> = [
  { value: "default", labelKey: "settings.editor.framePreset.default" },
  { value: "minimal", labelKey: "settings.editor.framePreset.minimal" },
  { value: "product-hunt", labelKey: "settings.editor.framePreset.productHunt" },
  { value: "twitter", labelKey: "settings.editor.framePreset.twitter" },
  { value: "vertical", labelKey: "settings.editor.framePreset.vertical" },
];

const ASPECTS: readonly Exclude<DefaultAspect, "auto">[] = ["16:9", "9:16", "1:1", "4:3"];

const AUTOSAVE_OPTIONS: ReadonlyArray<{ value: string; labelKey: MessageKey }> = [
  { value: "15", labelKey: "settings.editor.autosave.15" },
  { value: "30", labelKey: "settings.editor.autosave.30" },
  { value: "60", labelKey: "settings.editor.autosave.60" },
  { value: "300", labelKey: "settings.editor.autosave.300" },
];

const QUALITY_OPTIONS: ReadonlyArray<{ value: PreviewQuality; labelKey: MessageKey }> = [
  { value: "auto", labelKey: "settings.editor.quality.auto" },
  { value: "full", labelKey: "settings.editor.quality.full" },
  { value: "half", labelKey: "settings.editor.quality.half" },
];

export function EditorPage({ settings, onChange }: SettingsProps) {
  const t = useT();
  const sliderId = useId();
  const knownPresets: SelectOption<string>[] = FRAME_PRESETS.map((p) => ({
    value: p.value,
    label: t(p.labelKey),
  }));
  const presets = knownPresets.some((p) => p.value === settings.defaultFramePreset)
    ? knownPresets
    : [...knownPresets, { value: settings.defaultFramePreset, label: settings.defaultFramePreset }];
  const knownAutosave: SelectOption<string>[] = AUTOSAVE_OPTIONS.map((o) => ({
    value: o.value,
    label: t(o.labelKey),
  }));
  const autosave = knownAutosave.some((o) => o.value === String(settings.autosaveIntervalSec))
    ? knownAutosave
    : [
        ...knownAutosave,
        {
          value: String(settings.autosaveIntervalSec),
          label: t("settings.editor.autosave.custom", {
            seconds: String(settings.autosaveIntervalSec),
          }),
        },
      ];
  const aspectOptions: SegmentedOption<DefaultAspect>[] = [
    { value: "auto", label: t("settings.editor.aspect.auto") },
    ...ASPECTS.map((a) => ({ value: a, label: a })),
  ];
  const qualityOptions = QUALITY_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));

  return (
    <div>
      <PageHeading>{t("settings.section.editor")}</PageHeading>

      <Select
        label={t("settings.editor.framePreset")}
        value={settings.defaultFramePreset}
        options={presets}
        onChange={(defaultFramePreset) => onChange({ defaultFramePreset })}
      />

      <Row label={t("settings.editor.aspect")}>
        <Segmented<DefaultAspect>
          name="settings-aspect"
          value={settings.defaultAspect}
          options={aspectOptions}
          onChange={(defaultAspect) => onChange({ defaultAspect })}
        />
      </Row>

      <Select
        label={t("settings.editor.autosave")}
        value={String(settings.autosaveIntervalSec)}
        options={autosave}
        onChange={(v) => onChange({ autosaveIntervalSec: Number(v) })}
      />

      <Row label={t("settings.editor.previewQuality")}>
        <Segmented<PreviewQuality>
          name="settings-preview-quality"
          value={settings.previewQuality}
          options={qualityOptions}
          onChange={(previewQuality) => onChange({ previewQuality })}
        />
      </Row>

      <Switch
        checked={settings.autoZoomOnNewRecording}
        onChange={(autoZoomOnNewRecording) => onChange({ autoZoomOnNewRecording })}
        label={t("settings.editor.autoZoom")}
      />
      <Row>
        <label htmlFor={sliderId} style={labelStyle}>
          {t("settings.editor.autoZoomSensitivity")}
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.autoZoomSensitivity}
            disabled={!settings.autoZoomOnNewRecording}
            onChange={(e) => onChange({ autoZoomSensitivity: Number(e.target.value) })}
            style={{ maxWidth: "240px", flex: 1, accentColor: "var(--accent)" }}
          />
          <span
            style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-2)" }}
          >
            {Math.round(settings.autoZoomSensitivity * 100)}%
          </span>
        </div>
      </Row>

      <Switch
        checked={settings.snapByDefault}
        onChange={(snapByDefault) => onChange({ snapByDefault })}
        label={t("settings.editor.snap")}
      />
      <Switch
        checked={settings.inspectorAutoSwitch}
        onChange={(inspectorAutoSwitch) => onChange({ inspectorAutoSwitch })}
        label={t("settings.editor.inspectorAutoSwitch")}
      />
      <NumberField
        label={t("settings.editor.undoHistory")}
        value={settings.undoHistorySize}
        min={10}
        max={1000}
        integer
        suffix={t("settings.editor.steps")}
        onChange={(undoHistorySize) => onChange({ undoHistorySize })}
      />
    </div>
  );
}
