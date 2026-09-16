import { useId } from "react";
import type { ReactElement } from "react";
import type { GifDither, GifFps, GifSizePreset } from "../../export/gif/types";
import {
  ChipGroup,
  type ChoiceOption,
  OptionRow,
  PillSegmented,
  PillSelect,
  RowHint,
  Switch,
  mono,
  pillField,
} from "../../export/ui/controls";
import { type MessageKey, type Translate, useT } from "../../i18n";
import type {
  AudioChoice,
  CaptionsChoice,
  ExportFlowConfig,
  GifPalette,
  RangeChoice,
} from "./config";

/**
 * The S22 option rows the base ExportDialog doesn't draw, split by where the
 * design places them:
 *   - {@link ExportMediaOptions}: audio + hardware acceleration (MP4/WebM), or
 *     GIF size / fps / dither / palette / colours / loop.
 *   - {@link ExportOutputOptions}: range, captions, file name.
 *   - {@link ExportAfterOptions}: reveal / copy after export.
 * {@link ExportOptions} renders all three in order.
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
  { value: "burn-in", labelKey: "exportFlow.options.captions.burnIn" },
  { value: "srt", labelKey: "exportFlow.options.captions.srt" },
  { value: "vtt", labelKey: "exportFlow.options.captions.vtt" },
  { value: "none", labelKey: "common.none" },
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
const GIF_FPS: ReadonlyArray<ChoiceOption<GifFps>> = [
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
): Array<ChoiceOption<T>> => options.map((o) => ({ value: o.value, label: t(o.labelKey) }));

const COLORS_MIN = 32;
const COLORS_MAX = 256;

export function ExportMediaOptions(props: ExportOptionsProps): ReactElement {
  const { config, onChange } = props;
  const t = useT();
  const ids = {
    audio: useId(),
    size: useId(),
    fps: useId(),
    dither: useId(),
    palette: useId(),
    colors: useId(),
  };

  if (config.format !== "gif") {
    return (
      <>
        <OptionRow label={t("exportFlow.options.audio")} htmlFor={ids.audio}>
          <PillSelect
            id={ids.audio}
            value={config.audio}
            options={AUDIO.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={(audio) => onChange({ audio: audio as AudioChoice })}
          />
        </OptionRow>
        <Switch
          label={t("exportFlow.options.hardwareAcceleration")}
          checked={config.hardwareAcceleration}
          onChange={(hardwareAcceleration) => onChange({ hardwareAcceleration })}
        />
      </>
    );
  }

  const gif = config.gif;
  const pct = ((gif.colors - COLORS_MIN) / (COLORS_MAX - COLORS_MIN)) * 100;
  return (
    <>
      <OptionRow label={t("exportFlow.options.size")} labelId={ids.size}>
        <ChipGroup
          name="export-gif-size"
          labelledBy={ids.size}
          value={gif.sizePreset}
          options={translated(GIF_SIZE, t)}
          onChange={(sizePreset) => onChange({ gif: { ...gif, sizePreset } })}
        />
      </OptionRow>
      <OptionRow label={t("exportFlow.options.gifFps")} labelId={ids.fps}>
        <ChipGroup
          name="export-gif-fps"
          labelledBy={ids.fps}
          value={gif.fps}
          options={GIF_FPS}
          onChange={(fps) => onChange({ gif: { ...gif, fps } })}
        />
      </OptionRow>
      <OptionRow label={t("exportFlow.options.dither")} labelId={ids.dither}>
        <ChipGroup
          name="export-gif-dither"
          labelledBy={ids.dither}
          value={gif.dither}
          options={translated(DITHER, t)}
          onChange={(dither) => onChange({ gif: { ...gif, dither } })}
        />
      </OptionRow>
      <OptionRow label={t("exportFlow.options.palette")} labelId={ids.palette}>
        <ChipGroup
          name="export-gif-palette"
          labelledBy={ids.palette}
          value={gif.palette ?? "global"}
          options={translated(PALETTE, t)}
          onChange={(palette) => onChange({ gif: { ...gif, palette } })}
        />
      </OptionRow>
      {gif.palette === "adaptive" ? (
        <RowHint>{t("exportFlow.options.palette.adaptiveHint")}</RowHint>
      ) : null}
      <OptionRow label={t("exportFlow.options.colors")} htmlFor={ids.colors}>
        <input
          id={ids.colors}
          type="range"
          min={COLORS_MIN}
          max={COLORS_MAX}
          step={8}
          value={gif.colors}
          aria-valuetext={t("exportFlow.options.colorsValue", { colors: gif.colors })}
          onChange={(e) => onChange({ gif: { ...gif, colors: Number(e.target.value) } })}
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            height: "4px",
            margin: 0,
            accentColor: "var(--accent)",
            background: `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-panel-raised) ${pct}%)`,
            borderRadius: "999px",
            cursor: "pointer",
          }}
        />
        <span style={{ ...mono, width: "28px", textAlign: "right", color: "var(--text-1)" }}>
          {gif.colors}
        </span>
      </OptionRow>
      <Switch
        label={t("exportFlow.options.loop")}
        checked={gif.loop}
        onChange={(loop) => onChange({ gif: { ...gif, loop } })}
      />
    </>
  );
}

export function ExportOutputOptions(props: ExportOptionsProps): ReactElement {
  const { config, onChange } = props;
  const t = useT();
  const ids = { range: useId(), captions: useId(), fileName: useId() };
  return (
    <>
      <OptionRow label={t("exportFlow.options.range")} labelId={ids.range}>
        <PillSegmented
          name="export-range"
          labelledBy={ids.range}
          value={config.range}
          options={translated(RANGE, t)}
          onChange={(range) => onChange({ range })}
        />
      </OptionRow>
      {config.range === "selection" && !props.hasSelection ? (
        <RowHint tone="warning">{t("exportFlow.issue.selectRange")}</RowHint>
      ) : null}
      {config.range === "in-out" && !props.hasInOut ? (
        <RowHint tone="warning">{t("exportFlow.issue.setInOut")}</RowHint>
      ) : null}

      <OptionRow label={t("exportFlow.options.captions")} labelId={ids.captions}>
        <PillSegmented
          name="export-captions"
          labelledBy={ids.captions}
          value={config.captions}
          options={translated(CAPTIONS, t)}
          onChange={(captions) => onChange({ captions })}
        />
      </OptionRow>
      {!props.hasCaptions && config.captions !== "none" ? (
        <RowHint tone="warning">{t("exportFlow.issue.noCaptions")}</RowHint>
      ) : null}

      <OptionRow label={t("exportFlow.options.fileName")} htmlFor={ids.fileName}>
        <input
          id={ids.fileName}
          aria-label={t("exportFlow.options.fileName")}
          value={config.fileName}
          onChange={(e) => onChange({ fileName: e.target.value })}
          style={{ ...pillField, ...mono, flex: "1 1 auto" }}
        />
      </OptionRow>
    </>
  );
}

export function ExportAfterOptions(props: ExportOptionsProps): ReactElement {
  const { config, onChange } = props;
  const t = useT();
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px 16px",
        alignItems: "center",
        paddingTop: "2px",
      }}
    >
      <Switch
        layout="inline"
        label={t("exportFlow.options.revealAfter")}
        checked={config.revealAfter}
        onChange={(revealAfter) => onChange({ revealAfter })}
      />
      <Switch
        layout="inline"
        label={t("exportFlow.options.copyAfter")}
        checked={config.copyAfter}
        onChange={(copyAfter) => onChange({ copyAfter })}
      />
    </div>
  );
}

/** All option rows in design order (media, output, after-export). */
export function ExportOptions(props: ExportOptionsProps): ReactElement {
  return (
    <div
      data-testid="export-options"
      style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "11px" }}
    >
      <ExportMediaOptions {...props} />
      <ExportOutputOptions {...props} />
      <ExportAfterOptions {...props} />
    </div>
  );
}
