import { Input, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import type { ReactElement, ReactNode } from "react";
import type { GifDither, GifFps, GifSizePreset } from "../../export/gif/types";
import { type MessageKey, type Translate, useT } from "../../i18n";
import type {
  AudioChoice,
  CaptionsChoice,
  ExportFlowConfig,
  GifPalette,
  RangeChoice,
} from "./config";

/**
 * The S22 option rows the base ExportDialog doesn't draw: range, captions,
 * audio + hardware acceleration (MP4/WebM), GIF size/fps/loop/dither/colors,
 * file name and the after-export switches.
 */

export interface ExportOptionsProps {
  config: ExportFlowConfig;
  onChange(patch: Partial<ExportFlowConfig>): void;
  hasSelection: boolean;
  hasInOut: boolean;
  hasCaptions: boolean;
}

interface KeyedOption<T extends string | number> {
  value: T;
  labelKey: MessageKey;
}

const RANGE: ReadonlyArray<KeyedOption<RangeChoice>> = [
  { value: "entire", labelKey: "exportFlow.options.range.entire" },
  { value: "selection", labelKey: "exportFlow.options.range.selection" },
  { value: "in-out", labelKey: "exportFlow.options.range.inOut" },
];

const CAPTIONS: ReadonlyArray<KeyedOption<CaptionsChoice>> = [
  { value: "none", labelKey: "common.none" },
  { value: "burn-in", labelKey: "exportFlow.options.captions.burnIn" },
  { value: "srt", labelKey: "exportFlow.options.captions.srt" },
  { value: "vtt", labelKey: "exportFlow.options.captions.vtt" },
];

const AUDIO: ReadonlyArray<KeyedOption<AudioChoice>> = [
  { value: "aac", labelKey: "exportFlow.options.audio.aac" },
  { value: "mute", labelKey: "exportFlow.options.audio.mute" },
];

const GIF_SIZE: ReadonlyArray<KeyedOption<GifSizePreset>> = [
  { value: 480, labelKey: "exportFlow.options.size.small" },
  { value: 720, labelKey: "exportFlow.options.size.medium" },
  { value: 1080, labelKey: "exportFlow.options.size.large" },
];

/** Plain numbers: nothing to translate. */
const GIF_FPS: ReadonlyArray<SegmentedOption<GifFps>> = [
  { value: 10, label: "10" },
  { value: 15, label: "15" },
  { value: 20, label: "20" },
  { value: 30, label: "30" },
];

const DITHER: ReadonlyArray<KeyedOption<GifDither>> = [
  { value: "none", labelKey: "exportFlow.options.dither.none" },
  { value: "bayer4", labelKey: "exportFlow.options.dither.bayer" },
  { value: "floyd-steinberg", labelKey: "exportFlow.options.dither.floyd" },
];

const PALETTE: ReadonlyArray<KeyedOption<GifPalette>> = [
  { value: "global", labelKey: "exportFlow.options.palette.global" },
  { value: "adaptive", labelKey: "exportFlow.options.palette.adaptive" },
];

const translated = <T extends string | number>(
  options: ReadonlyArray<KeyedOption<T>>,
  t: Translate,
): Array<SegmentedOption<T>> => options.map((o) => ({ value: o.value, label: t(o.labelKey) }));

const labelStyle = {
  display: "block",
  marginBottom: "var(--space-2)",
  fontFamily: "var(--font-body)",
  color: "var(--text-2)",
  fontSize: "0.85rem",
} as const;

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div style={{ marginBottom: "var(--space-4)" }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
}

function Toggle(props: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}): ReactElement {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        fontFamily: "var(--font-body)",
        color: "var(--text-1)",
        marginBottom: "var(--space-2)",
      }}
    >
      <input
        type="checkbox"
        role="switch"
        aria-checked={props.checked}
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)" }}
      />
      {props.label}
    </label>
  );
}

const hint = (text: string): ReactElement => (
  <div style={{ ...labelStyle, color: "var(--text-3)", marginTop: "var(--space-2)" }}>{text}</div>
);

export function ExportOptions(props: ExportOptionsProps): ReactElement {
  const { config, onChange } = props;
  const t = useT();
  const isGif = config.format === "gif";
  return (
    <div data-testid="export-options">
      <Row label={t("exportFlow.options.range")}>
        <Segmented
          name="export-range"
          value={config.range}
          options={translated(RANGE, t)}
          onChange={(range) => onChange({ range })}
        />
        {config.range === "selection" && !props.hasSelection
          ? hint(t("exportFlow.issue.selectRange"))
          : null}
        {config.range === "in-out" && !props.hasInOut ? hint(t("exportFlow.issue.setInOut")) : null}
      </Row>

      <Row label={t("exportFlow.options.captions")}>
        <Segmented
          name="export-captions"
          value={config.captions}
          options={translated(CAPTIONS, t)}
          onChange={(captions) => onChange({ captions })}
        />
        {!props.hasCaptions && config.captions !== "none"
          ? hint(t("exportFlow.issue.noCaptions"))
          : null}
      </Row>

      {isGif ? (
        <>
          <Row label={t("exportFlow.options.size")}>
            <Segmented
              name="export-gif-size"
              value={config.gif.sizePreset}
              options={translated(GIF_SIZE, t)}
              onChange={(sizePreset) => onChange({ gif: { ...config.gif, sizePreset } })}
            />
          </Row>
          <Row label={t("exportFlow.options.gifFps")}>
            <Segmented
              name="export-gif-fps"
              value={config.gif.fps}
              options={GIF_FPS}
              onChange={(fps) => onChange({ gif: { ...config.gif, fps } })}
            />
          </Row>
          <Row label={t("exportFlow.options.dither")}>
            <Segmented
              name="export-gif-dither"
              value={config.gif.dither}
              options={translated(DITHER, t)}
              onChange={(dither) => onChange({ gif: { ...config.gif, dither } })}
            />
          </Row>
          <Row label={t("exportFlow.options.palette")}>
            <Segmented
              name="export-gif-palette"
              value={config.gif.palette ?? "global"}
              options={translated(PALETTE, t)}
              onChange={(palette) => onChange({ gif: { ...config.gif, palette } })}
            />
            {config.gif.palette === "adaptive"
              ? hint(t("exportFlow.options.palette.adaptiveHint"))
              : null}
          </Row>
          <Row label={t("exportFlow.options.colorsValue", { colors: config.gif.colors })}>
            <input
              type="range"
              aria-label={t("exportFlow.options.colors")}
              min={32}
              max={256}
              step={8}
              value={config.gif.colors}
              onChange={(e) => onChange({ gif: { ...config.gif, colors: Number(e.target.value) } })}
              style={{ width: "100%", accentColor: "var(--accent)" }}
            />
          </Row>
          <Toggle
            label={t("exportFlow.options.loop")}
            checked={config.gif.loop}
            onChange={(loop) => onChange({ gif: { ...config.gif, loop } })}
          />
        </>
      ) : (
        <>
          <Row label={t("exportFlow.options.audio")}>
            <Segmented
              name="export-audio"
              value={config.audio}
              options={translated(AUDIO, t)}
              onChange={(audio) => onChange({ audio })}
            />
          </Row>
          <Toggle
            label={t("exportFlow.options.hardwareAcceleration")}
            checked={config.hardwareAcceleration}
            onChange={(hardwareAcceleration) => onChange({ hardwareAcceleration })}
          />
        </>
      )}

      <div style={{ margin: "var(--space-3) 0" }}>
        <Input
          label={t("exportFlow.options.fileName")}
          aria-label={t("exportFlow.options.fileName")}
          value={config.fileName}
          onChange={(e) => onChange({ fileName: e.target.value })}
        />
      </div>
      <Toggle
        label={t("exportFlow.options.revealAfter")}
        checked={config.revealAfter}
        onChange={(revealAfter) => onChange({ revealAfter })}
      />
      <Toggle
        label={t("exportFlow.options.copyAfter")}
        checked={config.copyAfter}
        onChange={(copyAfter) => onChange({ copyAfter })}
      />
    </div>
  );
}
