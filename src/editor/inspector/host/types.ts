import type { ModelId } from "../../../../electron/captions/models";
import type { ProjectMeta } from "../../persistence";
import type { EditorData } from "../../store";
import type { DeleteProjectOptions, SourceStat } from "../project/types";

/**
 * Capabilities the inspector tabs need from outside the editor (file dialogs,
 * project folder, captions runtime, audio decoding, history). The orchestrator
 * passes a real implementation to `InspectorPanel`; tests pass fakes.
 * Every method may reject — tabs surface the message inline.
 */

export interface FileFilter {
  name: string;
  extensions: readonly string[];
}

export interface PickFileOptions {
  title: string;
  filters: readonly FileFilter[];
}

export interface SaveFileOptions {
  title: string;
  defaultName: string;
  filters: readonly FileFilter[];
  /** UTF-8 text written to the chosen path. */
  contents: string;
}

/**
 * What an imported file is for. `webcam` / `audio` / `image` / `font` are the
 * `system:copyIntoProject` kinds (they decide the `media/imported/` sub-folder);
 * the others ride on one of those (see {@link ipcImportKind}).
 */
export type ImportKind = "webcam" | "audio" | "image" | "font" | "cursor" | "sound";

/** Kinds the `system:copyIntoProject` channel accepts. */
export type IpcImportKind = "webcam" | "audio" | "image" | "font";

/** Custom cursors are copied like images (no probe); click sounds like audio. */
export function ipcImportKind(kind: ImportKind): IpcImportKind {
  switch (kind) {
    case "cursor":
      return "image";
    case "sound":
      return "audio";
    default:
      return kind;
  }
}

export interface ImportedMedia {
  /** Project-relative path (posix separators) to store in the document. */
  path: string;
  /** `reelform-media://` URL the renderer can load. */
  url: string;
  /** Probed duration; null when unknown (images). */
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}

export interface RelinkRequest {
  /** Absolute path of the replacement file the user picked. */
  filePath: string;
  expected: { durationMs: number; width?: number | undefined; height?: number | undefined };
}

export interface RelinkResult {
  /** New source `path` (project-relative or absolute). */
  path: string;
  url: string | null;
}

export interface TrimSourceResult {
  /** Clips rewritten against the trimmed file. */
  clips: NonNullable<ProjectMeta["clips"]>;
  /** New project-relative video path. */
  videoPath: string;
  videoDurationMs: number;
  savedBytes: number;
  /** Token for `restoreTrimmedSource` (the original is stashed until app quit). */
  undoToken?: string | undefined;
  /**
   * Linked tracks main cut to the same range (same undo token). Absent keys
   * were not trimmed; the webcam's `syncOffsetMs` is unchanged by the same cut.
   */
  linked?: TrimmedLinkedSources | undefined;
}

export interface TrimmedLinkedMedia {
  /** New project-relative path. */
  path: string;
  durationMs: number;
}

export interface TrimmedLinkedSources {
  mic?: TrimmedLinkedMedia | undefined;
  system?: TrimmedLinkedMedia | undefined;
  webcam?: TrimmedLinkedMedia | undefined;
  /** Rewritten telemetry (timestamps shifted by the trim offset). */
  telemetry?:
    | { path: string; pointCount: number; hasClicks: boolean; hasKeys: boolean }
    | undefined;
}

/** Side effects a meta history entry runs when it is undone / redone. */
export interface MetaUpdateEffects {
  /** After the entry's state is rolled back. */
  onUndo?: (() => void) | undefined;
  /** After the entry's state is re-applied by redo (not on the first apply). */
  onRedo?: (() => void) | undefined;
}

/** Decoded PCM (one Float32Array per channel). */
export interface DecodedAudio {
  channels: readonly Float32Array[];
  sampleRate: number;
  durationMs: number;
}

export interface CaptionModelStatus {
  id: ModelId;
  installed: boolean;
  downloading: boolean;
  displaySize: string;
}

export type CaptionsProgressEvent =
  | { kind: "download"; taskId: string; progress: number | null }
  | {
      kind: "transcribe";
      taskId: string;
      progress: number;
      doneMs: number;
      totalMs: number;
    };

export interface TranscribeRange {
  startMs: number;
  endMs: number;
  rate?: number | undefined;
}

export interface TranscribedCaption {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  words: { t0: number; t1: number; text: string }[];
}

/** `captions:*` channels (SPEC §9.6). */
export interface CaptionsPort {
  models(): Promise<CaptionModelStatus[]>;
  download(model: ModelId): Promise<void>;
  cancelDownload(model: ModelId): Promise<void>;
  transcribe(req: {
    jobId: string;
    audioPath: string;
    ranges: readonly TranscribeRange[];
    model: ModelId;
    language: string;
  }): Promise<{ captions: TranscribedCaption[] }>;
  onProgress(cb: (e: CaptionsProgressEvent) => void): () => void;
}

export type EditorPatch = Partial<EditorData>;

export interface InspectorHost {
  // ── System ────────────────────────────────────────────────
  pickFile(opts: PickFileOptions): Promise<string | null>;
  /** Resolves the written path, or null when cancelled. */
  saveFile(opts: SaveFileOptions): Promise<string | null>;
  readTextFile(path: string): Promise<string>;
  reveal(path: string): Promise<void>;

  // ── Project folder ────────────────────────────────────────
  importMedia(kind: ImportKind, sourcePath: string): Promise<ImportedMedia>;
  relinkMedia(req: RelinkRequest): Promise<RelinkResult>;
  /** ffmpeg `-c copy` cut to the used range with 1s handles (§9.9); null when unsupported. */
  trimSource(clips: NonNullable<ProjectMeta["clips"]>): Promise<TrimSourceResult | null>;
  /** Move a trimmed original back (undo of `trimSource`); absent when unsupported. */
  restoreTrimmedSource?: ((undoToken: string) => Promise<void>) | undefined;
  deleteProject(opts: DeleteProjectOptions): Promise<void>;
  /** Sizes of project-relative source paths; absent key = unknown. */
  statSources(paths: readonly string[]): Promise<Record<string, SourceStat>>;

  // ── Media ─────────────────────────────────────────────────
  decodeAudio(url: string): Promise<DecodedAudio | null>;
  captions: CaptionsPort;

  // ── Document / history ────────────────────────────────────
  /** One undoable edit of editor document state. */
  documentUpdate(label: string, patch: EditorPatch, coalesceKey?: string | undefined): void;
  /**
   * One undoable edit touching project meta (sources, clips, name) and,
   * optionally, editor state in the same history entry.
   */
  metaUpdate(
    label: string,
    update: (meta: ProjectMeta) => ProjectMeta,
    patch?: EditorPatch | undefined,
    effects?: MetaUpdateEffects | undefined,
  ): void;

  /** Platform for shortcut glyphs. */
  platform: "mac" | "win" | "linux";
  /** Runs heavy work after the current frame so "Analyzing…" can paint. */
  defer(work: () => void): void;
}
