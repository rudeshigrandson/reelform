/**
 * Export dialog (ENGINEERING_SPEC §10, guide S22) — presentational.
 *
 * Library `Dialog` (640px in the design). Three visual states, driven by the `phase` prop:
 *   - `idle`  → two columns: preview + duration / estimated size / encoder on
 *               the left; format track, resolution, frame rate, quality (with
 *               bitrate), codec chips, media options, then range / captions /
 *               filename / destination / after-export options on the right.
 *               The estimate rides on the Export button.
 *   - progress phases (`preparing`..`finalizing`) → phase label, bar, Cancel.
 *   - `done`  → success card with Reveal / Copy / Close.
 *
 * The component is pure UI: it holds only draft form state and calls back to the
 * parent for every action. Bitrate is computed via `exportBitrate` from the
 * sibling `../bitrate` module.
 */

import { Button, Dialog } from "@design/components";
import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { exportBitrate } from "../bitrate";
import {
  ChipGroup,
  type ChoiceOption,
  OptionRow,
  PillSegmented,
  PillSelect,
  ProgressTrack,
  RowHint,
  StatusGlyph,
  ThumbPlaceholder,
  formatTimecode,
  mono,
  pillField,
} from "./controls";
import type {
  ExportCodec,
  ExportFormat,
  ExportFps,
  ExportPhase,
  ExportQuality,
  ExportUiConfig,
} from "./types";

export interface ExportDialogProps {
  open: boolean;
  /** Timeline duration in milliseconds; used to estimate output size. */
  durationMs: number;
  initialConfig?: ExportUiConfig;
  phase: ExportPhase;
  /** Progress fraction 0..1 for the active render phase. */
  progress?: number;
  onExport: (config: ExportUiConfig) => void;
  onCancel: () => void;
  onChangeDestination?: () => void;
  onCancelExport?: () => void;
  onReveal?: () => void;
  onClose: () => void;
  /** Codecs this device cannot encode, with the reason shown ("Not supported on this device"). */
  unsupportedCodecs?: Partial<Record<ExportCodec, string>> | undefined;
  /** Controlled destination shown/emitted instead of the draft value (folder picked by the parent). */
  destinationPath?: string | undefined;
  /** Size estimate text replacing the built-in readout size (e.g. the GIF estimate). */
  sizeEstimate?: string | undefined;
  /** Validation messages; shown above the footer. */
  issues?: readonly string[] | undefined;
  exportDisabled?: boolean | undefined;
  /** Called whenever the draft config changes (live estimates in the parent). */
  onConfigChange?: ((config: ExportUiConfig) => void) | undefined;
  /** Encoder summary for the left column (e.g. "Hardware encoder"); status text while probing. */
  encoderLabel?: ReactNode;
  /** Encoder value tone: success (hardware) or muted. */
  encoderTone?: "success" | "muted" | undefined;
  /** Note card under the summary (e.g. how captions are exported). */
  note?: ReactNode;
  /** Format-specific rows after the codec (audio + hardware, or GIF options). */
  mediaOptions?: ReactNode;
  /** Rows in the output section, before the destination (range, captions, filename). */
  outputOptions?: ReactNode;
  /** Rows after the destination (reveal / copy after export). */
  afterOptions?: ReactNode;
  /** Status lines above the form (checking encoders, cancelled…). */
  status?: ReactNode;
  /** Extra option content; rendered at the end of the media section. */
  children?: ReactNode;
}

/** A named resolution option; "Original" keeps the source dimensions. */
interface ResolutionChoice {
  id: string;
  label: string;
  /** null → keep the config's current width/height ("Original"). */
  width: number | null;
  height: number | null;
}

const RESOLUTIONS: ReadonlyArray<ResolutionChoice> = [
  { id: "1080p", label: "1080p", width: 1920, height: 1080 },
  { id: "1440p", label: "1440p", width: 2560, height: 1440 },
  { id: "4k", label: "4K", width: 3840, height: 2160 },
  { id: "original", label: "Original", width: null, height: null },
];

const FORMAT_OPTIONS: ReadonlyArray<ChoiceOption<ExportFormat>> = [
  { value: "mp4", label: "MP4" },
  { value: "gif", label: "GIF" },
  { value: "webm", label: "WebM" },
];

const FPS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "30", label: "30" },
  { value: "60", label: "60" },
];

const QUALITY_OPTIONS: ReadonlyArray<ChoiceOption<ExportQuality>> = [
  { value: "High", label: "High" },
  { value: "Max", label: "Max" },
];

const MP4_CODECS: ReadonlyArray<ChoiceOption<ExportCodec>> = [
  { value: "h264", label: "H.264" },
  { value: "hevc", label: "HEVC" },
  { value: "av1", label: "AV1" },
];

const WEBM_CODECS: ReadonlyArray<ChoiceOption<ExportCodec>> = [{ value: "vp9", label: "VP9" }];

/** Progress phases in order, mapped to a human label. */
const PHASE_LABEL: Record<Exclude<ExportPhase, "idle" | "done">, string> = {
  preparing: "Preparing",
  rendering: "Rendering",
  "encoding-audio": "Encoding audio",
  muxing: "Muxing",
  finalizing: "Finalizing",
};

const DEFAULT_CONFIG: ExportUiConfig = {
  format: "mp4",
  width: 1920,
  height: 1080,
  fps: 60,
  codec: "h264",
  quality: "High",
  destinationPath: "~/Movies/reelform-export.mp4",
};

/** Legal codecs for a given format; used to keep codec valid on format change. */
function codecsFor(format: ExportFormat): ReadonlyArray<ChoiceOption<ExportCodec>> {
  if (format === "webm") return WEBM_CODECS;
  if (format === "mp4") return MP4_CODECS;
  return [];
}

function formatMbps(bitsPerSec: number): string {
  return `${(bitsPerSec / 1_000_000).toFixed(1)} Mbps`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

const summaryRow = { display: "flex", justifyContent: "space-between", gap: "8px" } as const;

export function ExportDialog(props: ExportDialogProps): React.JSX.Element | null {
  const {
    open,
    durationMs,
    initialConfig,
    phase,
    progress,
    onExport,
    onCancel,
    onChangeDestination,
    onCancelExport,
    onReveal,
    onClose,
    unsupportedCodecs,
    destinationPath,
    sizeEstimate,
    issues,
    exportDisabled,
    onConfigChange,
    children,
  } = props;

  const [config, setConfig] = useState<ExportUiConfig>(initialConfig ?? DEFAULT_CONFIG);
  const [resolutionId, setResolutionId] = useState<string>("1080p");
  const ids = {
    resolution: useId(),
    fps: useId(),
    quality: useId(),
    codec: useId(),
    destination: useId(),
  };

  const durationSeconds = durationMs / 1000;

  const readout = useMemo<{ bitrate: string; size: string } | null>(() => {
    if (config.format === "gif") return null;
    const bits = exportBitrate(
      config.width,
      config.height,
      config.fps,
      config.codec,
      config.quality,
    );
    const bytes = (bits * durationSeconds) / 8;
    return { bitrate: formatMbps(bits), size: formatBytes(bytes) };
  }, [config, durationSeconds]);

  function patch(partial: Partial<ExportUiConfig>): void {
    const next = { ...config, ...partial };
    setConfig(next);
    onConfigChange?.(next);
  }

  const isUnsupported = (codec: ExportCodec): boolean => unsupportedCodecs?.[codec] !== undefined;

  function onFormatChange(format: ExportFormat): void {
    const codecs = codecsFor(format);
    // Keep codec valid for the new format (GIF has none — leave as-is, hidden).
    const first = codecs.find((c) => !isUnsupported(c.value)) ?? codecs[0];
    const nextCodec =
      (codecs.some((c) => c.value === config.codec) && !isUnsupported(config.codec)) ||
      first === undefined
        ? config.codec
        : first.value;
    patch({ format, codec: nextCodec });
  }

  function onResolutionChange(id: string): void {
    setResolutionId(id);
    const choice = RESOLUTIONS.find((r) => r.id === id);
    if (choice && choice.width !== null && choice.height !== null) {
      patch({ width: choice.width, height: choice.height });
    }
  }

  const isProgress =
    phase === "preparing" ||
    phase === "rendering" ||
    phase === "encoding-audio" ||
    phase === "muxing" ||
    phase === "finalizing";

  // --- Progress view -------------------------------------------------------
  if (isProgress) {
    const pct = Math.round(Math.min(Math.max(progress ?? 0, 0), 1) * 100);
    return (
      <Dialog open={open} onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={{ fontFamily: "var(--font-heading)", fontSize: "18px" }}>Exporting…</div>
            <span style={{ ...mono, fontSize: "12px", color: "var(--text-2)" }}>{pct}%</span>
          </div>
          <ProgressTrack fraction={pct / 100} label="Export progress" />
          <div style={{ fontSize: "11px", color: "var(--text-2)" }} data-testid="progress-phase">
            {PHASE_LABEL[phase]}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={onCancelExport}>
              Cancel
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  // --- Done view -----------------------------------------------------------
  if (phase === "done") {
    const fileName = config.destinationPath.split(/[\\/]/).pop() || config.destinationPath;
    return (
      <Dialog open={open} onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <StatusGlyph tone="success" />
            <div style={{ fontFamily: "var(--font-heading)", fontSize: "18px" }}>
              Export finished
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: "12px",
              alignItems: "center",
              padding: "12px",
              borderRadius: "12px",
              background: "var(--bg-panel-raised)",
            }}
          >
            <ThumbPlaceholder width="64px" height="38px" radius="6px" />
            <div style={{ flex: 1, minWidth: 0, fontSize: "12px" }}>
              <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{fileName}</div>
              <div style={{ ...mono, color: "var(--text-3)", wordBreak: "break-all" }}>
                {config.destinationPath}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Button variant="primary" onClick={onReveal}>
              Reveal in Finder
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(config.destinationPath);
              }}
            >
              Copy
            </Button>
            <Button variant="ghost" onClick={onClose} style={{ marginLeft: "auto" }}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  // --- Configuration form (idle) ------------------------------------------
  const isGif = config.format === "gif";
  const codecOptions = codecsFor(config.format).map((opt) => {
    const reason = unsupportedCodecs?.[opt.value];
    return reason === undefined ? opt : { ...opt, disabled: true, title: reason };
  });
  const unsupportedNote = codecsFor(config.format)
    .filter((c) => isUnsupported(c.value))
    .map((c) => c.label)
    .join(", ");
  const shownDestination = destinationPath ?? config.destinationPath;
  const sizeText = readout
    ? `~${sizeEstimate ?? readout.size}`
    : sizeEstimate
      ? `~${sizeEstimate}`
      : "size varies";
  const buttonEstimate = readout || sizeEstimate ? sizeText : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={640}
      title="Export"
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={exportDisabled}
            onClick={() => onExport({ ...config, destinationPath: shownDestination })}
          >
            Export
            {buttonEstimate ? <span style={mono}>· {buttonEstimate}</span> : null}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" }}>
        {/* Left: preview + summary */}
        <div
          style={{
            width: "236px",
            flex: "1 1 200px",
            maxWidth: "236px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <ThumbPlaceholder height="133px" inner>
            <span
              style={{
                ...mono,
                position: "absolute",
                left: "8px",
                bottom: "8px",
                padding: "4px 9px",
                borderRadius: "999px",
                background: "color-mix(in srgb, var(--bg-sunken) 75%, transparent)",
                color: "var(--text-1)",
                fontSize: "10px",
              }}
            >
              {isGif ? config.format.toUpperCase() : `${config.width} × ${config.height}`}
              {isGif ? "" : ` · ${config.fps} fps`}
            </span>
          </ThumbPlaceholder>
          <div
            data-testid="bitrate-readout"
            style={{
              fontSize: "11px",
              color: "var(--text-3)",
              display: "flex",
              flexDirection: "column",
              gap: "5px",
            }}
          >
            <div style={summaryRow}>
              <span>Duration</span>
              <span style={{ ...mono, color: "var(--text-1)" }}>{formatTimecode(durationMs)}</span>
            </div>
            <div style={summaryRow}>
              <span>Estimated size</span>
              <span data-testid="size-value" style={{ ...mono, color: "var(--text-1)" }}>
                {sizeText}
              </span>
            </div>
            {props.encoderLabel !== undefined && !isGif ? (
              <div style={summaryRow}>
                <span>Encoder</span>
                <span
                  style={{
                    color: props.encoderTone === "success" ? "var(--success)" : "var(--text-2)",
                    textAlign: "right",
                  }}
                >
                  {props.encoderLabel}
                </span>
              </div>
            ) : null}
          </div>
          {props.note ? (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: "12px",
                background: "var(--bg-panel-raised)",
                fontSize: "11px",
                color: "var(--text-2)",
              }}
            >
              {props.note}
            </div>
          ) : null}
        </div>

        {/* Right: options */}
        <div
          style={{
            flex: "1 1 280px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            fontSize: "11px",
          }}
        >
          {props.status}
          <PillSegmented
            name="export-format"
            ariaLabel="Format"
            value={config.format}
            options={FORMAT_OPTIONS}
            onChange={onFormatChange}
            fontSize="12px"
            padding="6px"
          />

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {!isGif ? (
              <>
                <OptionRow label="Resolution" htmlFor={ids.resolution}>
                  <PillSelect
                    id={ids.resolution}
                    value={resolutionId}
                    options={RESOLUTIONS.map((r) => ({ value: r.id, label: r.label }))}
                    onChange={onResolutionChange}
                  />
                </OptionRow>
                <OptionRow label="Frame rate" htmlFor={ids.fps}>
                  <PillSelect
                    id={ids.fps}
                    value={String(config.fps)}
                    options={FPS_OPTIONS}
                    onChange={(v) => patch({ fps: (v === "30" ? 30 : 60) as ExportFps })}
                  />
                </OptionRow>
                <OptionRow label="Quality" labelId={ids.quality}>
                  <PillSegmented
                    name="export-quality"
                    labelledBy={ids.quality}
                    value={config.quality}
                    options={QUALITY_OPTIONS}
                    onChange={(quality) => patch({ quality })}
                  />
                </OptionRow>
                {readout ? (
                  <RowHint mono>
                    <span data-testid="bitrate-value">≈ {readout.bitrate}</span>
                  </RowHint>
                ) : null}
                <OptionRow label="Codec" labelId={ids.codec}>
                  <ChipGroup
                    name="export-codec"
                    labelledBy={ids.codec}
                    value={config.codec}
                    options={codecOptions}
                    onChange={(codec) => {
                      if (!isUnsupported(codec)) patch({ codec });
                    }}
                  />
                </OptionRow>
                {unsupportedNote ? (
                  <RowHint testId="codec-unsupported-note">
                    {unsupportedNote}: Not supported on this device
                  </RowHint>
                ) : null}
              </>
            ) : null}
            {props.mediaOptions}
            {children}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              paddingTop: "10px",
              borderTop: "1px solid var(--border)",
            }}
          >
            {props.outputOptions}
            <OptionRow label="Destination" htmlFor={ids.destination}>
              <input
                id={ids.destination}
                readOnly
                aria-label="Destination"
                value={shownDestination}
                title={shownDestination}
                style={{
                  ...pillField,
                  ...mono,
                  flex: "1 1 auto",
                  color: "var(--text-2)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              />
              {onChangeDestination ? (
                <Button
                  variant="ghost"
                  onClick={onChangeDestination}
                  style={{ padding: "4px 6px", fontSize: "11px" }}
                >
                  Change…
                </Button>
              ) : null}
            </OptionRow>
            {props.afterOptions}
          </div>

          {issues && issues.length > 0 ? (
            <ul
              role="alert"
              style={{
                margin: 0,
                padding: "8px 12px 8px 26px",
                borderRadius: "12px",
                background: "color-mix(in srgb, var(--record) 12%, transparent)",
                color: "color-mix(in srgb, var(--record) 35%, var(--text-1))",
                fontSize: "12px",
              }}
            >
              {issues.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

/** Fixture for previews and tests. */
export const sampleExportProps: ExportDialogProps = {
  open: true,
  durationMs: 30_000,
  phase: "idle",
  onExport: () => {},
  onCancel: () => {},
  onChangeDestination: () => {},
  onCancelExport: () => {},
  onReveal: () => {},
  onClose: () => {},
};
