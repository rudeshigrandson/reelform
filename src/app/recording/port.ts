import type { ChannelName, EventName, EventPayloadOf, RequestOf, ResponseOf } from "@contracts";
import { rmsToLevel } from "../../recording/micMeter";
import type { RecordingEvent, RecordingPort } from "../../recording/port";
import { invoke as ipcInvoke, onEvent as ipcOnEvent } from "../ipc";

/**
 * App ports for the recording flow, adapted onto the typed IPC client.
 *
 * - {@link AppRecordingPort}: `recording:*` channels. `writeChunk` sends the
 *   chunk's `ArrayBuffer` as-is (structured clone, never base64) and resolves
 *   only when main has appended it, so the renderer chunk pump's serial awaits
 *   are the backpressure.
 * - {@link WindowsPort} / {@link ProjectPort}: `windows:*` / `project:*`.
 * - {@link SystemPort}: reveal / delete / permission settings — injected, since
 *   reveal has no channel yet (the orchestrator adapts it).
 *
 * Main's `recording:event` union is mapped onto the renderer vocabulary
 * explicitly by {@link mapMainRecordingEvent}.
 */

export type MainRecordingEvent = EventPayloadOf<"recording:event">;
export type SourcesResult = ResponseOf<"recording:listSources">;
export type StartRecordingRequest = RequestOf<"recording:start">;
export type StartRecordingResult = ResponseOf<"recording:start">;
export type FinalizeResult = ResponseOf<"recording:finalize">;
export type CreateProjectRequest = RequestOf<"project:create">;
export type CreateProjectResult = ResponseOf<"project:create">;
export type SaveProjectRequest = RequestOf<"project:save">;
export type ClosableWindowKind = RequestOf<"windows:closeKind">["kind"];
export type HudExpansionSize = NonNullable<RequestOf<"windows:setHudExpansion">["size"]>;
export type HudLayoutInfo = NonNullable<ResponseOf<"windows:setHudExpansion">["layout"]>;

export interface AppRecordingPort extends RecordingPort {
  listSources(): Promise<SourcesResult>;
  start(req: StartRecordingRequest): Promise<StartRecordingResult>;
  finalize(sessionId: string): Promise<FinalizeResult>;
}

export interface WindowsPort {
  openHud(displayId?: string | undefined): Promise<void>;
  openCountdown(displayId?: string | undefined): Promise<void>;
  /** Resolves with the display ids that got an overlay. */
  openRegionOverlays(): Promise<string[]>;
  setRegionSelecting(displayId: string, selecting: boolean): Promise<void>;
  openWebcamBubble(): Promise<void>;
  closeKind(kind: ClosableWindowKind): Promise<void>;
  openEditor(projectId: string): Promise<void>;
}

/** What the HUD window itself needs from `windows:*` (pre-record popovers, preview, settings). */
export interface HudWindowsPort extends Pick<WindowsPort, "openWebcamBubble" | "closeKind"> {
  /** Grow the HUD window for popovers keeping the pill anchored; `null` collapses. */
  setHudExpansion(size: HudExpansionSize | null): Promise<HudLayoutInfo | null>;
  openSettings(): Promise<void>;
}

export interface ProjectPort {
  create(req: CreateProjectRequest): Promise<CreateProjectResult>;
  save(req: SaveProjectRequest): Promise<void>;
}

export type PermissionSettingsKind = "screen" | "microphone" | "camera";

export interface SystemPort {
  /** Show the project folder in Finder / Explorer. */
  reveal(path: string): Promise<void>;
  /** Delete (move to trash) a just-recorded project. */
  deleteProject(path: string): Promise<void>;
  openPermissionSettings?: ((kind: PermissionSettingsKind) => Promise<void>) | undefined;
}

export interface IpcClient {
  invoke<K extends ChannelName>(channel: K, payload: RequestOf<K>): Promise<ResponseOf<K> | null>;
  onEvent<K extends EventName>(channel: K, cb: (payload: EventPayloadOf<K>) => void): () => void;
}

export const defaultIpcClient: IpcClient = { invoke: ipcInvoke, onEvent: ipcOnEvent };

export const IPC_UNAVAILABLE = "IPC_UNAVAILABLE";

/** `invoke` resolves null outside Electron; the recording flow cannot work there. */
async function call<K extends ChannelName>(
  ipc: IpcClient,
  channel: K,
  payload: RequestOf<K>,
): Promise<ResponseOf<K>> {
  const res = await ipc.invoke(channel, payload);
  if (res === null) {
    throw { code: IPC_UNAVAILABLE, message: `${channel} needs the Electron main process` };
  }
  return res;
}

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

/** Main `recording:event` → renderer {@link RecordingEvent}. Exhaustive by type. */
export function mapMainRecordingEvent(e: MainRecordingEvent): RecordingEvent {
  const sessionId = e.sessionId;
  switch (e.type) {
    case "countdown":
      return { sessionId, type: "countdown", remaining: e.remaining };
    case "started":
      return { sessionId, type: "started", backend: e.backend };
    case "paused":
      return { sessionId, type: "paused", elapsedMs: finite(e.recordedMs) };
    case "resumed":
      return { sessionId, type: "resumed", elapsedMs: finite(e.recordedMs) };
    case "stats":
      return {
        sessionId,
        type: "stats",
        elapsedMs: finite(e.recordedMs),
        fps: finite(e.fps),
        droppedFrames: finite(e.droppedFrames),
        fileBytes: finite(e.fileBytes),
        micLevel: e.micRms === undefined ? undefined : rmsToLevel(e.micRms),
      };
    case "stopped":
      return { sessionId, type: "stopped", elapsedMs: finite(e.recordedMs), reason: e.reason };
    case "interrupted":
      return {
        sessionId,
        type: "interrupted",
        reason: e.reason,
        message: e.detail,
        elapsedMs: finite(e.recordedMs),
      };
    case "diskLow":
      return { sessionId, type: "diskLow", freeBytes: e.freeBytes };
    case "deviceLost":
      return { sessionId, type: "deviceLost", device: e.device };
    case "discarded":
      return { sessionId, type: "discarded" };
    case "error":
      return { sessionId, type: "error", code: e.code, message: e.message };
    default: {
      const unreachable: never = e;
      return unreachable;
    }
  }
}

export function createIpcRecordingPort(ipc: IpcClient = defaultIpcClient): AppRecordingPort {
  return {
    listSources: () => call(ipc, "recording:listSources", undefined),
    start: (req) => call(ipc, "recording:start", req),
    finalize: (sessionId) => call(ipc, "recording:finalize", { sessionId }),
    pause: async (sessionId) => {
      await call(ipc, "recording:pause", { sessionId });
    },
    resume: async (sessionId) => {
      await call(ipc, "recording:resume", { sessionId });
    },
    stop: async (sessionId) => {
      await call(ipc, "recording:stop", { sessionId });
    },
    discard: async (sessionId) => {
      await call(ipc, "recording:discard", { sessionId });
    },
    writeChunk: async (req) => {
      await call(
        ipc,
        "recording:writeChunk",
        req.timing
          ? {
              sessionId: req.sessionId,
              track: req.track,
              seq: req.seq,
              chunk: req.chunk,
              timing: req.timing,
            }
          : { sessionId: req.sessionId, track: req.track, seq: req.seq, chunk: req.chunk },
      );
    },
    endTrack: async (req) => {
      await call(ipc, "recording:endTrack", {
        sessionId: req.sessionId,
        track: req.track,
        chunkCount: req.chunkCount,
        mimeType: req.mimeType,
      });
    },
    subscribe: (listener) =>
      ipc.onEvent("recording:event", (payload) => listener(mapMainRecordingEvent(payload))),
  };
}

export function createIpcWindowsPort(ipc: IpcClient = defaultIpcClient): WindowsPort {
  return {
    openHud: async (displayId) => {
      await call(ipc, "windows:openHud", displayId === undefined ? {} : { displayId });
    },
    openCountdown: async (displayId) => {
      await call(ipc, "windows:openCountdown", displayId === undefined ? {} : { displayId });
    },
    openRegionOverlays: async () =>
      (await call(ipc, "windows:openRegionOverlays", undefined)).displayIds,
    setRegionSelecting: async (displayId, selecting) => {
      await call(ipc, "windows:setRegionSelecting", { displayId, selecting });
    },
    openWebcamBubble: async () => {
      await call(ipc, "windows:openWebcamBubble", {});
    },
    closeKind: async (kind) => {
      await call(ipc, "windows:closeKind", { kind });
    },
    openEditor: async (projectId) => {
      await call(ipc, "windows:openEditor", { projectId });
    },
  };
}

export function createIpcHudWindowsPort(ipc: IpcClient = defaultIpcClient): HudWindowsPort {
  return {
    openWebcamBubble: async () => {
      await call(ipc, "windows:openWebcamBubble", {});
    },
    closeKind: async (kind) => {
      await call(ipc, "windows:closeKind", { kind });
    },
    setHudExpansion: async (size) => (await call(ipc, "windows:setHudExpansion", { size })).layout,
    openSettings: async () => {
      await call(ipc, "windows:openSettings", undefined);
    },
  };
}

export function createIpcProjectPort(ipc: IpcClient = defaultIpcClient): ProjectPort {
  return {
    create: (req) => call(ipc, "project:create", req),
    save: async (req) => {
      await call(ipc, "project:save", req);
    },
  };
}

/**
 * SystemPort over existing channels: delete → `project:trash`, permission
 * settings → `permissions:openSettings`. `reveal` has no channel yet, so it is
 * injected (e.g. a future `system:reveal` wired by the orchestrator).
 */
export function createIpcSystemPort(
  reveal: (path: string) => Promise<void>,
  ipc: IpcClient = defaultIpcClient,
): SystemPort {
  return {
    reveal,
    deleteProject: async (path) => {
      await call(ipc, "project:trash", { path });
    },
    openPermissionSettings: async (kind) => {
      await call(ipc, "permissions:openSettings", { kind });
    },
  };
}
