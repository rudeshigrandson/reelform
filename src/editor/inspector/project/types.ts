/**
 * Project inspector view model (design guide S21). Built from a `Project`
 * document plus filesystem metadata the main process supplies; the component
 * only ever sees this shape.
 */

/** One media file backing the project. */
export interface SourceInfo {
  /** Which source slot this is, e.g. "video". */
  role: string;
  /** Path relative to the project dir, as stored in the document. */
  path: string;
  /** Absolute path (project location + relative path). */
  absolutePath: string;
  /** Size on disk; `null` when unknown or the file is missing. */
  sizeBytes: number | null;
  /** True when the file could not be found on disk. */
  missing: boolean;
  durationMs: number;
}

/** "Recording info" block. */
export interface RecordingInfo {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  codec: string;
  /** Capture backend used, e.g. "ScreenCaptureKit"; `null` when unknown. */
  captureBackend: string | null;
  /** Number of recorded cursor samples; `null` when no cursor data. */
  cursorPointCount: number | null;
  /** Human labels of recorded audio tracks, e.g. "MacBook Pro Microphone". */
  audioTracks: readonly string[];
}

export interface ProjectInfo {
  id: string;
  name: string;
  /** Absolute path of the project directory / `.reelform` bundle. */
  locationPath: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  modifiedAt: string;
  sources: readonly SourceInfo[];
  recording: RecordingInfo;
}

/** Stat result for a source file; `null` = missing on disk. */
export type SourceStat = { sizeBytes: number } | null;

/** Filesystem / capture metadata that is not part of the project document. */
export interface ProjectFsMeta {
  locationPath: string;
  /** Keyed by the source's relative `path`. Absent key = size unknown (not missing). */
  sourceStats: Readonly<Record<string, SourceStat>>;
  captureBackend?: string | null | undefined;
  cursorPointCount?: number | null | undefined;
  audioTracks?: readonly string[] | undefined;
}

/** Per-project persistence preference shown as the "Save raw with project" switch. */
export interface ProjectPrefs {
  saveRawWithProject: boolean;
}

export const DEFAULT_PROJECT_PREFS: ProjectPrefs = { saveRawWithProject: true };

/** Options for the delete confirmation (S27 "Delete project?"). */
export interface DeleteProjectOptions {
  alsoDeleteRecordings: boolean;
}

/** Locale / timezone injection so date output is deterministic. */
export interface DateFormatOptions {
  locale?: string | undefined;
  timeZone?: string | undefined;
}
