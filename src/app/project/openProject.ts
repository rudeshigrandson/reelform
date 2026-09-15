import type { ChannelName, IpcError, RequestOf, ResponseOf } from "@contracts";
import type { StoreApi, UseBoundStore } from "zustand";
import { registerProjectFonts } from "../../editor/captions/fonts";
import { peaksFromAudio } from "../../editor/inspector/host/audioPeaks";
import type { MediaSourceV1, ProjectV1 } from "../../editor/model/v1";
import { migrate } from "../../editor/model/v1";
import {
  DEFAULT_TELEMETRY_PATH,
  type ParsedTelemetry,
  type ProjectMeta,
  fromProjectDocument,
  metaFromProjectDocument,
  readTelemetryFile,
} from "../../editor/persistence";
import { type PlaybackState, usePlaybackStore } from "../../editor/playback/store";
import {
  type SmoothedCursorTrack,
  buildSmoothedCursorTrack,
} from "../../editor/preview/cursorSmoothing";
import { type EditorData, type EditorState, useEditorStore } from "../../editor/store";
import { clipsDurationMs } from "../../editor/timelineBinding";
import { type ProjectSessionData, type ProjectSessionState, useProjectSession } from "./session";

/**
 * Editor boot (ENGINEERING_SPEC §6.1): projectId → folder → `project.json` →
 * migrate → hydrate the editor/playback/session stores → register the project
 * folder for `reelform-media://` → probe media → telemetry → smoothed cursor.
 * Every dependency is injected so the whole flow runs under test.
 */

/** Typed IPC call; resolves null outside Electron (same shape as `app/ipc.invoke`). */
export type ProjectInvoke = <K extends ChannelName>(
  channel: K,
  payload: RequestOf<K>,
) => Promise<ResponseOf<K> | null>;

export interface ProjectMediaPort {
  /** HEAD a media URL; false (or a rejection) means the file is offline. */
  exists(url: string): Promise<boolean>;
  fetchBytes(url: string): Promise<Uint8Array>;
  /** gunzip (renderer: `DecompressionStream`). */
  decompress(bytes: Uint8Array): Promise<Uint8Array>;
  /** Decode a media file's audio to PCM (timeline waveform); omitted → no waveform. */
  decodeAudio?:
    | ((url: string) => Promise<{ channels: readonly Float32Array[] } | null>)
    | undefined;
}

/** Filmstrip thumbnails: one every 2s of source at 160px height (SPEC §6.7). */
export const THUMBNAIL_INTERVAL_MS = 2000;
export const THUMBNAIL_HEIGHT_PX = 160;
/** Waveform resolution: one peak bucket per 10ms of source, capped. */
export const WAVEFORM_BUCKET_MS = 10;
export const WAVEFORM_MAX_BUCKETS = 200_000;

export type RecoveryInfo = ResponseOf<"project:recovery">["recovery"];

export interface ProjectStores {
  editor: UseBoundStore<StoreApi<EditorState>>;
  playback: UseBoundStore<StoreApi<PlaybackState>>;
  session: UseBoundStore<StoreApi<ProjectSessionState>>;
}

export const defaultProjectStores = (): ProjectStores => ({
  editor: useEditorStore,
  playback: usePlaybackStore,
  session: useProjectSession,
});

export interface OpenProjectDeps {
  invoke: ProjectInvoke;
  media: ProjectMediaPort;
  stores?: ProjectStores | undefined;
  /** Abort when the window navigates to another project mid-load. */
  signal?: AbortSignal | undefined;
}

export type OpenProjectResult =
  | {
      status: "ready";
      path: string;
      project: ProjectV1;
      recovery: RecoveryInfo;
      /** `media:registerRoot` ids to release on close. */
      mediaRootIds: string[];
    }
  | { status: "not-found"; error: IpcError }
  | { status: "error"; error: IpcError }
  | { status: "aborted" };

/** Stable codes this module adds on top of main's `FsErrorCode`s. */
export const PROJECT_OPEN_ERRORS = {
  unavailable: "IPC_UNAVAILABLE",
  invalid: "PROJECT_INVALID",
} as const;

const NOT_FOUND_CODES = new Set(["PROJECT_NOT_FOUND"]);

/** Normalise anything thrown into `{ code, message, details? }`. */
export function toIpcErrorShape(err: unknown): IpcError {
  if (typeof err === "object" && err !== null && typeof (err as IpcError).code === "string") {
    const e = err as IpcError;
    const message = typeof e.message === "string" ? e.message : e.code;
    return e.details === undefined
      ? { code: e.code, message }
      : { code: e.code, message, details: e.details };
  }
  return { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) };
}

class OpenError extends Error {
  constructor(readonly ipc: IpcError) {
    super(ipc.message);
  }
}

function required<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new OpenError({
      code: PROJECT_OPEN_ERRORS.unavailable,
      message: `${what} is only available in the desktop app`,
    });
  }
  return value;
}

/** `reelform-media://root/` + a project-relative path, each segment URL-encoded. */
export function mediaUrl(baseUrl: string, relativePath: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const segments = relativePath.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
  return base + segments.map(encodeURIComponent).join("/");
}

const isAbsolutePath = (p: string): boolean => p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);

function splitDir(p: string): { dir: string; file: string } {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return { dir: p.slice(0, Math.max(1, i)), file: p.slice(i + 1) };
}

/** Cursor smoothing is 0..100 in the document; the smoother takes a 0..1 knob. */
export function buildCursorTrack(
  telemetry: ParsedTelemetry | null,
  smoothing: number,
): SmoothedCursorTrack | null {
  if (!telemetry || telemetry.cursorPoints.length === 0) return null;
  const knob = Number.isFinite(smoothing) ? Math.min(1, Math.max(0, smoothing / 100)) : 0.5;
  return buildSmoothedCursorTrack(telemetry.cursorPoints, { smoothing: knob });
}

/** Timeline length from the clip sequence; the stored value only when there are no clips. */
export function derivedDurationMs(data: Pick<EditorData, "clips" | "durationMs">): number {
  return data.clips.length > 0 ? clipsDurationMs(data.clips) : data.durationMs;
}

/**
 * Validate/migrate a raw document and load it into the editor + playback
 * stores and the session's document fields. Throws `{ code, message }`.
 */
export function hydrateProjectDocument(
  raw: unknown,
  projectPath: string,
  stores: ProjectStores = defaultProjectStores(),
): ProjectV1 {
  const result = migrate(raw);
  if (!result.ok) {
    throw new OpenError({
      code: PROJECT_OPEN_ERRORS.invalid,
      message: result.error.message,
      details: { reason: result.error.code, issues: result.error.issues },
    });
  }
  const project = result.project;
  const data = fromProjectDocument(project);
  const meta: ProjectMeta = metaFromProjectDocument(project);
  const durationMs = derivedDurationMs(data);
  stores.editor.setState({ ...data, durationMs });
  const playback = stores.playback.getState();
  playback.reset();
  playback.setFps(meta.sources.video.fps);
  playback.setDuration(durationMs);
  const { video } = meta.sources;
  stores.session.getState().setSession({
    projectPath,
    projectId: project.id,
    meta,
    sourceSize: { width: video.width, height: video.height },
  });
  return project;
}

interface MediaResolution {
  urls: Pick<ProjectSessionData, "videoUrl" | "webcamUrl" | "micUrl" | "systemAudioUrl">;
  mediaRootId: string | null;
  mediaBaseUrl: string | null;
  telemetryUrl: string | null;
}

async function resolveMedia(
  projectPath: string,
  meta: ProjectMeta,
  cursorPointCount: number | null,
  invoke: ProjectInvoke,
  /** Registered root ids are appended as they happen, so a later failure can release them. */
  rootIds: string[],
): Promise<MediaResolution> {
  const project = await invoke("media:registerRoot", { path: projectPath });
  if (project) rootIds.push(project.rootId);
  const external = new Map<string, string>();

  const urlFor = async (path: string | undefined): Promise<string | null> => {
    if (path === undefined || path === "") return null;
    if (!isAbsolutePath(path)) return project ? mediaUrl(project.baseUrl, path) : null;
    // Relinked by reference (§9.9): serve its folder through its own root.
    const { dir, file } = splitDir(path);
    let base = external.get(dir);
    if (base === undefined) {
      const root = await invoke("media:registerRoot", { path: dir });
      if (!root) return null;
      rootIds.push(root.rootId);
      base = root.baseUrl;
      external.set(dir, base);
    }
    return mediaUrl(base, file);
  };
  const source = (s: MediaSourceV1 | undefined) => urlFor(s?.path);

  const telemetryPath =
    meta.sources.telemetry?.path ??
    (cursorPointCount !== null ? DEFAULT_TELEMETRY_PATH : undefined);
  return {
    mediaRootId: project?.rootId ?? null,
    mediaBaseUrl: project?.baseUrl ?? null,
    urls: {
      videoUrl: await source(meta.sources.video),
      webcamUrl: await source(meta.sources.webcam),
      micUrl: await source(meta.sources.mic),
      systemAudioUrl: await source(meta.sources.system),
    },
    telemetryUrl: await urlFor(telemetryPath),
  };
}

async function loadTelemetry(
  url: string | null,
  media: ProjectMediaPort,
): Promise<ParsedTelemetry | null> {
  if (url === null) return null;
  try {
    const bytes = await media.fetchBytes(url);
    return await readTelemetryFile(bytes, { decompress: (b) => media.decompress(b) });
  } catch {
    // No/corrupt telemetry disables the cursor layer; the project still opens (§6.6).
    return null;
  }
}

async function isOnline(url: string | null, media: ProjectMediaPort): Promise<boolean> {
  if (url === null) return false;
  try {
    return await media.exists(url);
  } catch {
    return false;
  }
}

export async function openProject(
  projectId: string,
  deps: OpenProjectDeps,
): Promise<OpenProjectResult> {
  const stores = deps.stores ?? defaultProjectStores();
  const session = stores.session;
  const aborted = () => deps.signal?.aborted === true;
  session.getState().reset();
  session.getState().setSession({ status: "loading", projectId });
  const rootIds: string[] = [];
  try {
    const { path } = required(
      await deps.invoke("project:resolve", { projectId }),
      "Opening projects",
    );
    if (aborted()) return { status: "aborted" };
    const opened = required(await deps.invoke("project:open", { path }), "Opening projects");
    if (aborted()) return { status: "aborted" };

    const project = hydrateProjectDocument(opened.document, opened.path, stores);
    const meta = session.getState().meta as ProjectMeta;
    const cursorPointCount = stores.editor.getState().cursorPointCount;

    const media = await resolveMedia(opened.path, meta, cursorPointCount, deps.invoke, rootIds);
    if (aborted()) return abort(rootIds, deps.invoke);
    const [online, telemetry] = await Promise.all([
      isOnline(media.urls.videoUrl, deps.media),
      loadTelemetry(media.telemetryUrl, deps.media),
    ]);
    if (aborted()) return abort(rootIds, deps.invoke);

    session.getState().setSession({
      ...media.urls,
      mediaRootId: media.mediaRootId,
      mediaBaseUrl: media.mediaBaseUrl,
      mediaOffline: !online,
      telemetry,
      cursorTrack: buildCursorTrack(telemetry, stores.editor.getState().cursor.smoothing),
      status: "ready",
      error: null,
    });
    void registerProjectFonts(
      media.mediaBaseUrl,
      stores.editor.getState().captionStyle.customFonts ?? [],
    );
    // Proxy, filmstrip and waveform never block opening (§6.1).
    void loadDerivedMedia(project.id, { ...deps, stores });
    return {
      status: "ready",
      path: opened.path,
      project,
      recovery: opened.recovery,
      mediaRootIds: rootIds,
    };
  } catch (err) {
    await releaseMediaRoots(rootIds, deps.invoke);
    if (aborted()) return { status: "aborted" };
    const error = err instanceof OpenError ? err.ipc : toIpcErrorShape(err);
    session.getState().setSession({ status: "error", error });
    return NOT_FOUND_CODES.has(error.code)
      ? { status: "not-found", error }
      : { status: "error", error };
  }
}

/**
 * Background media derived from the source (SPEC §6.1 boot, §6.3, §6.7): the
 * preview proxy, filmstrip thumbnails and waveform peaks. Each piece lands in
 * the session on its own as soon as it is ready; failures leave it empty. A
 * piece that finishes after the window moved to another project is dropped.
 */
export async function loadDerivedMedia(
  projectId: string,
  deps: Pick<OpenProjectDeps, "invoke" | "media" | "stores" | "signal">,
): Promise<void> {
  const session = (deps.stores ?? defaultProjectStores()).session;
  const current = () => deps.signal?.aborted !== true && session.getState().projectId === projectId;
  const base = session.getState().mediaBaseUrl;

  const proxy = (async () => {
    if (base === null) return;
    const res = await deps.invoke("project:ensureProxy", { projectId });
    if (res?.proxyPath && current()) {
      session.getState().setSession({ proxyUrl: mediaUrl(base, res.proxyPath) });
    }
  })();

  const thumbnails = (async () => {
    if (base === null) return;
    const res = await deps.invoke("project:ensureThumbnails", {
      projectId,
      intervalMs: THUMBNAIL_INTERVAL_MS,
      height: THUMBNAIL_HEIGHT_PX,
    });
    if (!res || !current()) return;
    const items = [...res.items]
      .filter((i) => Number.isFinite(i.sourceMs))
      .sort((a, b) => a.sourceMs - b.sourceMs)
      .map((i) => ({ sourceMs: i.sourceMs, url: mediaUrl(base, i.path) }));
    session.getState().setSession({ thumbnails: items });
  })();

  const waveform = (async () => {
    const { micUrl, systemAudioUrl, videoUrl, meta, mediaOffline } = session.getState();
    const url = micUrl ?? systemAudioUrl ?? (mediaOffline ? null : videoUrl);
    const durationMs = meta?.sources.video.durationMs ?? 0;
    if (url === null || !deps.media.decodeAudio || !(durationMs > 0)) return;
    const audio = await deps.media.decodeAudio(url);
    if (!audio || !current()) return;
    const buckets = Math.min(WAVEFORM_MAX_BUCKETS, Math.ceil(durationMs / WAVEFORM_BUCKET_MS));
    const peaks = peaksFromAudio(audio, buckets);
    if (peaks.length > 0)
      session.getState().setSession({ waveformPeaks: Float32Array.from(peaks) });
  })();

  await Promise.all([proxy, thumbnails, waveform].map((p) => p.catch(() => undefined)));
}

export interface RenameResult {
  path: string;
  /** Media roots registered for the new folder (the old ones are released). */
  mediaRootIds: string[];
}

/**
 * Top-bar rename of the open project (S12, §9.9): `project:rename` renames the
 * folder and the document name; the session follows the folder (its media roots
 * are re-registered and every media URL rebased) and keeps the new name in
 * `meta` so the next save writes it. Throws `{ code, message }`.
 */
export async function renameOpenProject(
  name: string,
  deps: Pick<OpenProjectDeps, "invoke" | "stores"> & { mediaRootIds: readonly string[] },
): Promise<RenameResult> {
  const stores = deps.stores ?? defaultProjectStores();
  const session = stores.session;
  const { projectPath, meta } = session.getState();
  if (projectPath === null || meta === null) {
    throw { code: "PROJECT_NOT_OPEN", message: "No project is open" };
  }
  try {
    const res = required(
      await deps.invoke("project:rename", { path: projectPath, name }),
      "Renaming projects",
    );
    // The rename rewrote project.json: keep the session's modifiedAt in step with disk.
    const renamed = {
      ...meta,
      name: name.trim(),
      ...(typeof res.modifiedAt === "string" ? { modifiedAt: res.modifiedAt } : {}),
    };
    if (res.path === projectPath) {
      session.getState().setSession({ meta: renamed });
      return { path: res.path, mediaRootIds: [...deps.mediaRootIds] };
    }
    const rootIds: string[] = [];
    try {
      const media = await resolveMedia(
        res.path,
        renamed,
        stores.editor.getState().cursorPointCount,
        deps.invoke,
        rootIds,
      );
      const { mediaBaseUrl: oldBase, thumbnails, proxyUrl } = session.getState();
      const rebase = (url: string): string =>
        oldBase !== null && media.mediaBaseUrl !== null && url.startsWith(oldBase)
          ? media.mediaBaseUrl + url.slice(oldBase.length)
          : url;
      session.getState().setSession({
        projectPath: res.path,
        meta: renamed,
        ...media.urls,
        mediaRootId: media.mediaRootId,
        mediaBaseUrl: media.mediaBaseUrl,
        proxyUrl: proxyUrl === null ? null : rebase(proxyUrl),
        thumbnails: thumbnails.map((t) => ({ ...t, url: rebase(t.url) })),
      });
    } catch (err) {
      await releaseMediaRoots(rootIds, deps.invoke);
      throw err;
    }
    await releaseMediaRoots(deps.mediaRootIds, deps.invoke);
    return { path: res.path, mediaRootIds: rootIds };
  } catch (err) {
    throw err instanceof OpenError ? err.ipc : toIpcErrorShape(err);
  }
}

async function abort(rootIds: string[], invoke: ProjectInvoke): Promise<OpenProjectResult> {
  await releaseMediaRoots(rootIds, invoke);
  return { status: "aborted" };
}

/** Best-effort `media:unregisterRoot` for every id. */
export async function releaseMediaRoots(
  rootIds: readonly string[],
  invoke: ProjectInvoke,
): Promise<void> {
  await Promise.all(
    rootIds.map((rootId) => invoke("media:unregisterRoot", { rootId }).catch(() => null)),
  );
}

/**
 * "Crash recovered" → Restore: main writes the backup over `project.json`, then
 * the stores re-hydrate from it. Media roots and telemetry stay as they are.
 */
export async function restoreProjectBackup(
  projectPath: string,
  backupName: string | undefined,
  deps: Pick<OpenProjectDeps, "invoke" | "stores">,
): Promise<ProjectV1> {
  const stores = deps.stores ?? defaultProjectStores();
  try {
    const res = required(
      await deps.invoke(
        "project:restore",
        backupName === undefined ? { path: projectPath } : { path: projectPath, backupName },
      ),
      "Restoring projects",
    );
    const project = hydrateProjectDocument(res.document, res.path, stores);
    const { telemetry } = stores.session.getState();
    stores.session.getState().setSession({
      cursorTrack: buildCursorTrack(telemetry, stores.editor.getState().cursor.smoothing),
    });
    return project;
  } catch (err) {
    throw err instanceof OpenError ? err.ipc : toIpcErrorShape(err);
  }
}

/**
 * Keep `session.cursorTrack` in step with `cursor.smoothing` and the loaded
 * telemetry (SPEC §6.6). Returns an unsubscribe.
 */
export function bindCursorTrack(stores: ProjectStores = defaultProjectStores()): () => void {
  let smoothing = stores.editor.getState().cursor.smoothing;
  let telemetry = stores.session.getState().telemetry;
  const rebuild = () => {
    stores.session.getState().setSession({ cursorTrack: buildCursorTrack(telemetry, smoothing) });
  };
  const offEditor = stores.editor.subscribe((s) => {
    if (s.cursor.smoothing === smoothing) return;
    smoothing = s.cursor.smoothing;
    rebuild();
  });
  const offSession = stores.session.subscribe((s) => {
    if (s.telemetry === telemetry) return;
    telemetry = s.telemetry;
    rebuild();
  });
  return () => {
    offEditor();
    offSession();
  };
}

/** Real renderer media port: `fetch` over `reelform-media://` + `DecompressionStream`. */
export const browserMediaPort: ProjectMediaPort = {
  async exists(url) {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  },
  async fetchBytes(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  },
  async decompress(bytes) {
    // Copy into a plain ArrayBuffer-backed view: BlobPart rejects SharedArrayBuffer views.
    const stream = new Blob([new Uint8Array(bytes)])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  },
  async decodeAudio(url) {
    const Ctx = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext })
      .OfflineAudioContext;
    if (!Ctx) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    // Sample rate only matters for decoding; 8kHz keeps a long recording small.
    const ctx = new Ctx(1, 1, 8000);
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    return {
      channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)),
    };
  },
};
