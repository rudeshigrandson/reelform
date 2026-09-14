/**
 * Export dialog (ENGINEERING_SPEC §10) — presentational.
 *
 * Rendered inside the library `Dialog` (title "Export"). Three visual states,
 * driven by the `phase` prop:
 *   - `idle`  → the configuration form (format / resolution / fps / codec /
 *               quality / destination) plus a live bitrate + size readout.
 *   - progress phases (`preparing`..`finalizing`) → a phase label, percent bar
 *               and a Cancel button.
 *   - `done`  → a success panel with Reveal / Copy / Close.
 *
 * The component is pure UI: it holds only draft form state and calls back to the
 * parent for every action. Bitrate is computed via `exportBitrate` from the
 * sibling `../bitrate` module.
 */

import { Button, Dialog, Input, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { exportBitrate } from "../bitrate";
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

const FORMAT_OPTIONS: ReadonlyArray<SegmentedOption<ExportFormat>> = [
  { value: "mp4", label: "MP4" },
  { value: "gif", label: "GIF" },
  { value: "webm", label: "WebM" },
];

const FPS_OPTIONS: ReadonlyArray<SegmentedOption<ExportFps>> = [
  { value: 30, label: "30" },
  { value: 60, label: "60" },
];

const QUALITY_OPTIONS: ReadonlyArray<SegmentedOption<ExportQuality>> = [
  { value: "High", label: "High" },
  { value: "Max", label: "Max" },
];

const MP4_CODECS: ReadonlyArray<SegmentedOption<ExportCodec>> = [
  { value: "h264", label: "H.264" },
  { value: "hevc", label: "HEVC" },
  { value: "av1", label: "AV1" },
];

const WEBM_CODECS: ReadonlyArray<SegmentedOption<ExportCodec>> = [{ value: "vp9", label: "VP9" }];

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
function codecsFor(format: ExportFormat): ReadonlyArray<SegmentedOption<ExportCodec>> {
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

const tokenStyles = {
  section: { marginBottom: "var(--space-4)" } as const,
  label: {
    display: "block",
    marginBottom: "var(--space-2)",
    fontFamily: "var(--font-body)",
    color: "var(--text-2)",
    fontSize: "0.85rem",
  } as const,
  select: {
    width: "100%",
    padding: "var(--space-2)",
    borderRadius: "var(--radius-md)",
    background: "var(--bg-sunken)",
    color: "var(--text-1)",
    border: "1px solid var(--border-strong)",
  } as const,
  readout: {
    display: "flex",
    justifyContent: "space-between",
    padding: "var(--space-3)",
    borderRadius: "var(--radius-md)",
    background: "var(--bg-sunken)",
    color: "var(--text-1)",
    fontFamily: "var(--font-body)",
    marginBottom: "var(--space-4)",
  } as const,
  destinationRow: {
    display: "flex",
    gap: "var(--space-2)",
    alignItems: "flex-end",
  } as const,
  progressTrack: {
    height: "8px",
    width: "100%",
    borderRadius: "var(--radius-full)",
    background: "var(--bg-active)",
    overflow: "hidden",
    marginBottom: "var(--space-3)",
  } as const,
  successPanel: {
    textAlign: "center",
    padding: "var(--space-4) 0",
  } as const,
  actionsRow: {
    display: "flex",
    gap: "var(--space-2)",
    justifyContent: "center",
  } as const,
} satisfies Record<string, React.CSSProperties>;

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={tokenStyles.section}>
      <span style={tokenStyles.label}>{label}</span>
      {children}
    </div>
  );
}

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
  } = props;

  const [config, setConfig] = useState<ExportUiConfig>(initialConfig ?? DEFAULT_CONFIG);
  const [resolutionId, setResolutionId] = useState<string>("1080p");

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
    setConfig((prev) => ({ ...prev, ...partial }));
  }

  function onFormatChange(format: ExportFormat): void {
    const codecs = codecsFor(format);
    // Keep codec valid for the new format (GIF has none — leave as-is, hidden).
    const first = codecs[0];
    const nextCodec =
      codecs.some((c) => c.value === config.codec) || first === undefined
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
      <Dialog
        open={open}
        onClose={onClose}
        title="Export"
        actions={
          <Button variant="secondary" onClick={onCancelExport}>
            Cancel
          </Button>
        }
      >
        <div>
          <div style={tokenStyles.label} data-testid="progress-phase">
            {PHASE_LABEL[phase]}
          </div>
          <div
            style={tokenStyles.progressTrack}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: "var(--accent)",
              }}
            />
          </div>
          <div style={{ fontFamily: "var(--font-body)", color: "var(--text-1)" }}>{pct}%</div>
        </div>
      </Dialog>
    );
  }

  // --- Done view -----------------------------------------------------------
  if (phase === "done") {
    return (
      <Dialog open={open} onClose={onClose} title="Export">
        <div style={tokenStyles.successPanel}>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "1.1rem",
              color: "var(--text-1)",
              marginBottom: "var(--space-4)",
            }}
          >
            Export complete
          </div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              color: "var(--text-2)",
              marginBottom: "var(--space-4)",
              wordBreak: "break-all",
            }}
          >
            {config.destinationPath}
          </div>
          <div style={tokenStyles.actionsRow}>
            <Button variant="secondary" onClick={onReveal}>
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
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  // --- Configuration form (idle) ------------------------------------------
  const showCodec = config.format !== "gif";
  const codecOptions = codecsFor(config.format);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onExport(config)}>
            Export
          </Button>
        </>
      }
    >
      <Labelled label="Format">
        <Segmented
          name="export-format"
          value={config.format}
          options={FORMAT_OPTIONS}
          onChange={onFormatChange}
        />
      </Labelled>

      <Labelled label="Resolution">
        <select
          aria-label="Resolution"
          style={tokenStyles.select}
          value={resolutionId}
          onChange={(e) => onResolutionChange(e.target.value)}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Labelled>

      <Labelled label="Frame rate">
        <Segmented
          name="export-fps"
          value={config.fps}
          options={FPS_OPTIONS}
          onChange={(fps) => patch({ fps })}
        />
      </Labelled>

      {showCodec ? (
        <Labelled label="Codec">
          <Segmented
            name="export-codec"
            value={config.codec}
            options={codecOptions}
            onChange={(codec) => patch({ codec })}
          />
        </Labelled>
      ) : null}

      <Labelled label="Quality">
        <Segmented
          name="export-quality"
          value={config.quality}
          options={QUALITY_OPTIONS}
          onChange={(quality) => patch({ quality })}
        />
      </Labelled>

      <div style={tokenStyles.readout} data-testid="bitrate-readout">
        {readout ? (
          <>
            <span data-testid="bitrate-value">{readout.bitrate}</span>
            <span data-testid="size-value">~{readout.size}</span>
          </>
        ) : (
          <span data-testid="size-value">size varies</span>
        )}
      </div>

      <div style={tokenStyles.destinationRow}>
        <div style={{ flex: 1 }}>
          <Input
            label="Destination"
            readOnly
            value={config.destinationPath}
            aria-label="Destination"
          />
        </div>
        <Button variant="secondary" onClick={onChangeDestination}>
          Change…
        </Button>
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
