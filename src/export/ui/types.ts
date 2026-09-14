/**
 * Local UI types for the Export dialog (ENGINEERING_SPEC §10).
 *
 * These describe only what the presentational dialog needs; the real export
 * config is assembled by the orchestrator from this shape.
 */

export type ExportFormat = "mp4" | "gif" | "webm";
export type ExportFps = 30 | 60;
export type ExportCodec = "h264" | "hevc" | "av1" | "vp9";
export type ExportQuality = "High" | "Max";

/** The user-chosen output settings the dialog emits on Export. */
export interface ExportUiConfig {
  format: ExportFormat;
  width: number;
  height: number;
  fps: ExportFps;
  codec: ExportCodec;
  quality: ExportQuality;
  destinationPath: string;
}

/**
 * Lifecycle phase of an export. `idle` is the configuration form; the four
 * middle phases are shown as a progress view; `done` shows the success panel.
 */
export type ExportPhase =
  | "idle"
  | "preparing"
  | "rendering"
  | "encoding-audio"
  | "muxing"
  | "finalizing"
  | "done";
