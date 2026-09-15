import type { ChannelName, EventName, EventPayloadOf, RequestOf, ResponseOf } from "@contracts";
import { createDefaultInspectorHost } from "../../editor/inspector/host/defaultHost";
import type {
  CaptionsPort,
  DecodedAudio,
  ImportKind,
  ImportedMedia,
  InspectorHost,
  IpcImportKind,
  PickFileOptions,
  SaveFileOptions,
  TrimSourceResult,
} from "../../editor/inspector/host/types";
import { ipcImportKind } from "../../editor/inspector/host/types";
import type { DeleteProjectOptions, SourceStat } from "../../editor/inspector/project/types";
import type { ProjectMeta } from "../../editor/persistence";
import { invoke as realInvoke, onEvent as realOnEvent } from "../ipc";
import { useProjectSession } from "../project/session";

/**
 * Real `InspectorHost` for the editor window. Captions, relink and delete go
 * over existing IPC channels; capabilities with no channel yet (file dialogs,
 * copying into `media/`, stat, trim) come in as {@link SystemPort} so the
 * orchestrator can adapt whichever domain lands them.
 */

export interface SystemPort {
  pickFile(opts: PickFileOptions): Promise<string | null>;
  saveFile(opts: SaveFileOptions): Promise<string | null>;
  readTextFile(path: string): Promise<string>;
  reveal(path: string): Promise<void>;
  /** Copy `sourcePath` into `<project>/media/imported/<kind>/` and return its relative path. */
  copyIntoProject(projectPath: string, kind: IpcImportKind, sourcePath: string): Promise<string>;
  statFiles(projectPath: string, relPaths: readonly string[]): Promise<Record<string, SourceStat>>;
  trimSource?:
    | ((projectPath: string, clips: NonNullable<ProjectMeta["clips"]>) => Promise<TrimSourceResult>)
    | undefined;
  /** `project:restoreTrimmedSource`: move the stashed original back (trim undo). */
  restoreTrimmedSource?: ((projectPath: string, undoToken: string) => Promise<void>) | undefined;
  /** Close the editor window after its project was trashed. */
  closeWindow?: (() => void) | undefined;
}

export type InvokeFn = <K extends ChannelName>(
  channel: K,
  payload: RequestOf<K>,
) => Promise<ResponseOf<K> | null>;
export type OnEventFn = <K extends EventName>(
  channel: K,
  cb: (payload: EventPayloadOf<K>) => void,
) => () => void;

export type AudioDecoder = (url: string) => Promise<DecodedAudio | null>;

export interface CreateInspectorHostDeps {
  system: SystemPort;
  /** Defaults to the preload bridge client. */
  invoke?: InvokeFn | undefined;
  onEvent?: OnEventFn | undefined;
  decodeAudio?: AudioDecoder | undefined;
  documentUpdate: InspectorHost["documentUpdate"];
  metaUpdate: InspectorHost["metaUpdate"];
  platform?: InspectorHost["platform"] | undefined;
  /** Session reader; defaults to the shared project session store. */
  getSession?: (() => { projectPath: string | null; mediaBaseUrl: string | null }) | undefined;
}

export class InspectorHostError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "InspectorHostError";
  }
}

const required = <T>(value: T | null, what: string): T => {
  if (value === null)
    throw new InspectorHostError("ipc-unavailable", `${what} needs the desktop app.`);
  return value;
};

/** `reelform-media://` URL for a project-relative path. */
export function mediaUrlFor(mediaBaseUrl: string | null, relPath: string): string | null {
  if (!mediaBaseUrl || relPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relPath)) return null;
  return `${mediaBaseUrl}${relPath.split("/").map(encodeURIComponent).join("/")}`;
}

export function createCaptionsPort(invoke: InvokeFn, onEvent: OnEventFn): CaptionsPort {
  return {
    async models() {
      const res = required(await invoke("captions:models", undefined), "Captions");
      return res.map((m) => ({
        id: m.id,
        installed: m.installed,
        downloading: m.downloading,
        displaySize: m.displaySize,
      }));
    },
    async download(model) {
      required(await invoke("captions:download", { model }), "Model download");
    },
    async cancelDownload(model) {
      await invoke("captions:cancelDownload", { model });
    },
    async transcribe(req) {
      const payload: RequestOf<"captions:transcribe"> = {
        jobId: req.jobId,
        audio: { path: req.audioPath },
        ranges: req.ranges.map((r) =>
          r.rate === undefined ? { startMs: r.startMs, endMs: r.endMs } : { ...r, rate: r.rate },
        ),
        model: req.model,
        language: req.language,
      };
      const res = required(await invoke("captions:transcribe", payload), "Transcription");
      return { captions: res.captions };
    },
    onProgress(cb) {
      return onEvent("captions:progress", (e) => {
        if (e.kind === "download") cb({ kind: "download", taskId: e.taskId, progress: e.progress });
        else
          cb({
            kind: "transcribe",
            taskId: e.taskId,
            progress: e.progress,
            doneMs: e.doneMs,
            totalMs: e.totalMs,
          });
      });
    },
  };
}

/** Web Audio decode of a served media URL (mono/stereo PCM). */
export async function webAudioDecode(url: string): Promise<DecodedAudio | null> {
  if (typeof fetch === "undefined" || typeof AudioContext === "undefined") return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(bytes);
    const channels: Float32Array[] = [];
    for (let i = 0; i < buf.numberOfChannels; i++) channels.push(buf.getChannelData(i));
    return { channels, sampleRate: buf.sampleRate, durationMs: buf.duration * 1000 };
  } catch {
    return null;
  } finally {
    void ctx.close();
  }
}

export function createInspectorHost(deps: CreateInspectorHostDeps): InspectorHost {
  const invoke = deps.invoke ?? (realInvoke as InvokeFn);
  const onEvent = deps.onEvent ?? (realOnEvent as OnEventFn);
  const getSession = deps.getSession ?? (() => useProjectSession.getState());
  const projectPath = (): string => {
    const p = getSession().projectPath;
    if (!p) throw new InspectorHostError("no-project", "No project is open.");
    return p;
  };

  const importMedia = async (kind: ImportKind, sourcePath: string): Promise<ImportedMedia> => {
    const root = projectPath();
    const channelKind = ipcImportKind(kind);
    const rel = await deps.system.copyIntoProject(root, channelKind, sourcePath);
    const url = mediaUrlFor(getSession().mediaBaseUrl, rel);
    if (!url)
      throw new InspectorHostError("media-unserved", "The project media folder isn't registered.");
    if (channelKind === "image") {
      // Images, fonts and cursors: nothing to probe.
      return { path: rel, url, durationMs: null, width: null, height: null, hasAudio: false };
    }
    // Probe failures are non-fatal: the tab falls back to the decoded duration.
    const probe = await invoke("media:probe", { path: sourcePath }).catch(() => null);
    return {
      path: rel,
      url,
      durationMs: probe?.durationMs ?? null,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      hasAudio: channelKind === "audio" || (probe?.hasAudio ?? false),
    };
  };
  const restore = deps.system.restoreTrimmedSource;

  return createDefaultInspectorHost({
    pickFile: (o) => deps.system.pickFile(o),
    saveFile: (o) => deps.system.saveFile(o),
    readTextFile: (p) => deps.system.readTextFile(p),
    reveal: (p) => deps.system.reveal(p),
    importMedia,
    async relinkMedia(req) {
      const expected: RequestOf<"project:relink">["expected"] = {
        durationMs: req.expected.durationMs,
      };
      if (req.expected.width !== undefined) expected.width = req.expected.width;
      if (req.expected.height !== undefined) expected.height = req.expected.height;
      const res = required(
        await invoke("project:relink", { path: projectPath(), filePath: req.filePath, expected }),
        "Relinking",
      );
      return { path: res.path, url: mediaUrlFor(getSession().mediaBaseUrl, res.path) };
    },
    async trimSource(clips) {
      return deps.system.trimSource ? deps.system.trimSource(projectPath(), clips) : null;
    },
    ...(restore
      ? { restoreTrimmedSource: (undoToken: string) => restore(projectPath(), undoToken) }
      : {}),
    async deleteProject(_opts: DeleteProjectOptions) {
      // §9.9: the whole `.reelform` folder (recordings included) goes to the OS trash.
      required(await invoke("project:trash", { path: projectPath() }), "Deleting projects");
      deps.system.closeWindow?.();
    },
    async statSources(paths) {
      const root = getSession().projectPath;
      return root ? deps.system.statFiles(root, paths) : {};
    },
    decodeAudio: deps.decodeAudio ?? webAudioDecode,
    captions: createCaptionsPort(invoke, onEvent),
    documentUpdate: deps.documentUpdate,
    metaUpdate: deps.metaUpdate,
    ...(deps.platform ? { platform: deps.platform } : {}),
  });
}
