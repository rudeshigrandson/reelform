import { Input, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import type { ReactElement, ReactNode } from "react";
import type { GifDither, GifFps, GifSizePreset } from "../../export/gif/types";
import type { AudioChoice, CaptionsChoice, ExportFlowConfig, RangeChoice } from "./config";

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

const RANGE: ReadonlyArray<SegmentedOption<RangeChoice>> = [
  { value: "entire", label: "Entire project" },
  { value: "selection", label: "Selection" },
  { value: "in-out", label: "In–Out" },
];

const CAPTIONS: ReadonlyArray<SegmentedOption<CaptionsChoice>> = [
  { value: "none", label: "None" },
  { value: "burn-in", label: "Burn in" },
  { value: "srt", label: "Sidecar .srt" },
  { value: "vtt", label: ".vtt" },
];

const AUDIO: ReadonlyArray<SegmentedOption<AudioChoice>> = [
  { value: "aac", label: "AAC 192k" },
  { value: "mute", label: "Mute" },
];

const GIF_SIZE: ReadonlyArray<SegmentedOption<GifSizePreset>> = [
  { value: 480, label: "Small 480p" },
  { value: 720, label: "Medium 720p" },
  { value: 1080, label: "Large 1080p" },
];

const GIF_FPS: ReadonlyArray<SegmentedOption<GifFps>> = [
  { value: 10, label: "10" },
  { value: 15, label: "15" },
  { value: 20, label: "20" },
  { value: 30, label: "30" },
];

const DITHER: ReadonlyArray<SegmentedOption<GifDither>> = [
  { value: "none", label: "No dither" },
  { value: "bayer4", label: "Bayer" },
  { value: "floyd-steinberg", label: "Floyd" },
];

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
  const isGif = config.format === "gif";
  return (
    <div data-testid="export-options">
      <Row label="Range">
        <Segmented
          name="export-range"
          value={config.range}
          options={RANGE}
          onChange={(range) => onChange({ range })}
        />
        {config.range === "selection" && !props.hasSelection
          ? hint("Select a range on the timeline first")
          : null}
        {config.range === "in-out" && !props.hasInOut ? hint("Set In and Out points first") : null}
      </Row>

      <Row label="Captions">
        <Segmented
          name="export-captions"
          value={config.captions}
          options={CAPTIONS}
          onChange={(captions) => onChange({ captions })}
        />
        {!props.hasCaptions && config.captions !== "none"
          ? hint("This project has no captions")
          : null}
      </Row>

      {isGif ? (
        <>
          <Row label="Size">
            <Segmented
              name="export-gif-size"
              value={config.gif.sizePreset}
              options={GIF_SIZE}
              onChange={(sizePreset) => onChange({ gif: { ...config.gif, sizePreset } })}
            />
          </Row>
          <Row label="GIF frame rate">
            <Segmented
              name="export-gif-fps"
              value={config.gif.fps}
              options={GIF_FPS}
              onChange={(fps) => onChange({ gif: { ...config.gif, fps } })}
            />
          </Row>
          <Row label="Dither">
            <Segmented
              name="export-gif-dither"
              value={config.gif.dither}
              options={DITHER}
              onChange={(dither) => onChange({ gif: { ...config.gif, dither } })}
            />
          </Row>
          <Row label={`Colors · ${config.gif.colors}`}>
            <input
              type="range"
              aria-label="Colors"
              min={32}
              max={256}
              step={8}
              value={config.gif.colors}
              onChange={(e) => onChange({ gif: { ...config.gif, colors: Number(e.target.value) } })}
              style={{ width: "100%", accentColor: "var(--accent)" }}
            />
          </Row>
          <Toggle
            label="Loop"
            checked={config.gif.loop}
            onChange={(loop) => onChange({ gif: { ...config.gif, loop } })}
          />
        </>
      ) : (
        <>
          <Row label="Audio">
            <Segmented
              name="export-audio"
              value={config.audio}
              options={AUDIO}
              onChange={(audio) => onChange({ audio })}
            />
          </Row>
          <Toggle
            label="Hardware acceleration (auto)"
            checked={config.hardwareAcceleration}
            onChange={(hardwareAcceleration) => onChange({ hardwareAcceleration })}
          />
        </>
      )}

      <div style={{ margin: "var(--space-3) 0" }}>
        <Input
          label="Filename"
          aria-label="Filename"
          value={config.fileName}
          onChange={(e) => onChange({ fileName: e.target.value })}
        />
      </div>
      <Toggle
        label="Reveal after export"
        checked={config.revealAfter}
        onChange={(revealAfter) => onChange({ revealAfter })}
      />
      <Toggle
        label="Copy to clipboard after export"
        checked={config.copyAfter}
        onChange={(copyAfter) => onChange({ copyAfter })}
      />
    </div>
  );
}
