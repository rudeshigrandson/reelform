import { Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { useId } from "react";
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
const FRAME_PRESETS: ReadonlyArray<SelectOption<string>> = [
  { value: "default", label: "Default" },
  { value: "minimal", label: "Minimal" },
  { value: "product-hunt", label: "Product Hunt" },
  { value: "twitter", label: "Twitter" },
  { value: "vertical", label: "Vertical" },
];

const ASPECT_OPTIONS: ReadonlyArray<SegmentedOption<DefaultAspect>> = [
  { value: "auto", label: "Auto" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
];

const AUTOSAVE_OPTIONS: ReadonlyArray<SelectOption<string>> = [
  { value: "15", label: "Every 15 seconds" },
  { value: "30", label: "Every 30 seconds" },
  { value: "60", label: "Every minute" },
  { value: "300", label: "Every 5 minutes" },
];

const QUALITY_OPTIONS: ReadonlyArray<SegmentedOption<PreviewQuality>> = [
  { value: "auto", label: "Auto" },
  { value: "full", label: "Full" },
  { value: "half", label: "Half" },
];

export function EditorPage({ settings, onChange }: SettingsProps) {
  const sliderId = useId();
  const presets = FRAME_PRESETS.some((p) => p.value === settings.defaultFramePreset)
    ? FRAME_PRESETS
    : [
        ...FRAME_PRESETS,
        { value: settings.defaultFramePreset, label: settings.defaultFramePreset },
      ];
  const autosave = AUTOSAVE_OPTIONS.some((o) => o.value === String(settings.autosaveIntervalSec))
    ? AUTOSAVE_OPTIONS
    : [
        ...AUTOSAVE_OPTIONS,
        {
          value: String(settings.autosaveIntervalSec),
          label: `Every ${settings.autosaveIntervalSec}s`,
        },
      ];

  return (
    <div>
      <PageHeading>Editor</PageHeading>

      <Select
        label="Default frame preset"
        value={settings.defaultFramePreset}
        options={presets}
        onChange={(defaultFramePreset) => onChange({ defaultFramePreset })}
      />

      <Row label="Default aspect">
        <Segmented<DefaultAspect>
          name="settings-aspect"
          value={settings.defaultAspect}
          options={ASPECT_OPTIONS}
          onChange={(defaultAspect) => onChange({ defaultAspect })}
        />
      </Row>

      <Select
        label="Autosave"
        value={String(settings.autosaveIntervalSec)}
        options={autosave}
        onChange={(v) => onChange({ autosaveIntervalSec: Number(v) })}
      />

      <Row label="Preview quality">
        <Segmented<PreviewQuality>
          name="settings-preview-quality"
          value={settings.previewQuality}
          options={QUALITY_OPTIONS}
          onChange={(previewQuality) => onChange({ previewQuality })}
        />
      </Row>

      <Switch
        checked={settings.autoZoomOnNewRecording}
        onChange={(autoZoomOnNewRecording) => onChange({ autoZoomOnNewRecording })}
        label="Auto-zoom on new recordings"
      />
      <Row>
        <label htmlFor={sliderId} style={labelStyle}>
          Auto-zoom sensitivity
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
        label="Snap by default"
      />
      <Switch
        checked={settings.inspectorAutoSwitch}
        onChange={(inspectorAutoSwitch) => onChange({ inspectorAutoSwitch })}
        label="Switch inspector tab to the selected item"
      />
      <NumberField
        label="Undo history size"
        value={settings.undoHistorySize}
        min={10}
        max={1000}
        integer
        suffix="steps"
        onChange={(undoHistorySize) => onChange({ undoHistorySize })}
      />
    </div>
  );
}
