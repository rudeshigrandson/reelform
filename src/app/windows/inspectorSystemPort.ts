import type { ChannelName, RequestOf, ResponseOf } from "@contracts";
import type {
  FileFilter as HostFileFilter,
  TrimSourceResult,
} from "../../editor/inspector/host/types";
import type { SystemPort } from "../inspector/createInspectorHost";

/**
 * The inspector host's file-system port over the `system:*` IPC channels
 * (dialogs, caption sidecar text, importing media into the project folder,
 * source sizes) plus `project:trimSource` / `project:restoreTrimmedSource`.
 * Outside Electron `invoke` resolves null; the port then reports cancelled
 * dialogs / unknown sizes, and throws only where a result is required.
 */

export type SystemInvoke = <K extends ChannelName>(
  channel: K,
  payload: RequestOf<K>,
) => Promise<ResponseOf<K> | null>;

export class NotBridgedError extends Error {
  readonly code = "NOT_BRIDGED";
  constructor(action: string) {
    super(`${action} needs the desktop app`);
    this.name = "NotBridgedError";
  }
}

/** Trim result plus what the editor needs to undo it (§9.9). */
export interface InspectorTrimSourceResult extends TrimSourceResult {
  /** Pass to `restoreTrimmedSource` to put the original back (until app quit). */
  undoToken: string;
  /** Milliseconds subtracted from every clip's source times. */
  offsetMs: number;
}

export interface InspectorSystemPort extends SystemPort {
  trimSource(
    projectPath: string,
    clips: TrimSourceResult["clips"],
  ): Promise<InspectorTrimSourceResult>;
  /** Undo a trim: moves the original back (the host restores `sources.video` itself). */
  restoreTrimmedSource(projectPath: string, undoToken: string): Promise<void>;
}

function toFilters(filters: readonly HostFileFilter[]) {
  return filters.map((f) => ({ name: f.name, extensions: [...f.extensions] }));
}

export function createInspectorSystemPort(
  invoke: SystemInvoke,
  closeWindow: () => void = () => window.close(),
): InspectorSystemPort {
  return {
    async pickFile(opts) {
      const res = await invoke("system:pickFile", {
        title: opts.title,
        filters: toFilters(opts.filters),
      });
      return res?.path ?? null;
    },

    async saveFile(opts) {
      const res = await invoke("system:saveDialog", {
        defaultName: opts.defaultName,
        filters: toFilters(opts.filters),
      });
      const path = res?.path ?? null;
      if (!path) return null;
      await invoke("system:writeTextFile", { path, contents: opts.contents });
      return path;
    },

    async readTextFile(path) {
      const res = await invoke("system:readTextFile", { path });
      if (!res) throw new NotBridgedError("Reading files");
      return res.text;
    },

    async reveal(path) {
      await invoke("system:reveal", { path });
    },

    async copyIntoProject(projectPath, kind, sourcePath) {
      const res = await invoke("system:copyIntoProject", { projectPath, kind, sourcePath });
      if (!res) throw new NotBridgedError("Importing media");
      return res.relPath;
    },

    async statFiles(projectPath, relPaths) {
      const res = await invoke("system:statFiles", { projectPath, relPaths: [...relPaths] });
      return res?.stats ?? {};
    },

    async trimSource(projectPath, clips) {
      if (clips.length === 0) throw new Error("There are no clips to trim to.");
      let startMs = Number.POSITIVE_INFINITY;
      let endMs = Number.NEGATIVE_INFINITY;
      for (const c of clips) {
        startMs = Math.min(startMs, c.sourceStartMs);
        endMs = Math.max(endMs, c.sourceEndMs);
      }
      const res = await invoke("project:trimSource", {
        path: projectPath,
        usedRange: { startMs, endMs },
      });
      if (!res) throw new NotBridgedError("Trimming the source");
      // Rewrite locally so every clip field keeps its exact type.
      const offset = res.offsetMs;
      return {
        clips: clips.map((c) => ({
          ...c,
          sourceStartMs: Math.max(0, c.sourceStartMs - offset),
          sourceEndMs: Math.max(0, c.sourceEndMs - offset),
        })),
        videoPath: res.videoPath,
        videoDurationMs: res.videoDurationMs,
        savedBytes: res.savedBytes,
        undoToken: res.undoToken,
        offsetMs: offset,
      };
    },

    async restoreTrimmedSource(projectPath, undoToken) {
      const res = await invoke("project:restoreTrimmedSource", { path: projectPath, undoToken });
      if (!res) throw new NotBridgedError("Restoring the original");
    },

    closeWindow,
  };
}
