import {
  type ChannelName,
  type EventName,
  type EventPayloadOf,
  ReelformIpcError,
  type RequestOf,
  type ResponseOf,
  decodeIpcError,
} from "@contracts";

/**
 * Thin renderer-side IPC client over the preload bridge. Falls back gracefully
 * when `window.reelform` is absent (e.g. Vite in a plain browser tab), so the
 * UI can be developed and tested outside Electron.
 */
export function isBridged(): boolean {
  return typeof window !== "undefined" && Boolean(window.reelform);
}

/**
 * Invoke a contract channel. Resolves null outside Electron. Main-process
 * failures reject with a {@link ReelformIpcError} carrying the stable `code`
 * the UI uses to pick copy; anything else is rethrown unchanged.
 */
export async function invoke<K extends ChannelName>(
  channel: K,
  payload: RequestOf<K>,
): Promise<ResponseOf<K> | null> {
  if (!isBridged()) return null;
  try {
    return await window.reelform.invoke(channel, payload);
  } catch (err) {
    const ipcError = decodeIpcError(err);
    throw ipcError ? new ReelformIpcError(ipcError) : err;
  }
}

/** Subscribe to a main → renderer event; returns an unsubscribe. No-op outside Electron. */
export function onEvent<K extends EventName>(
  channel: K,
  cb: (payload: EventPayloadOf<K>) => void,
): () => void {
  if (!isBridged()) return () => {};
  return window.reelform.on(channel, (payload) => cb(payload as EventPayloadOf<K>));
}

/** Best-effort app version from the main process; null outside Electron. */
export async function getAppVersion(): Promise<string | null> {
  const res = await invoke("system:ping", undefined);
  return res?.version ?? null;
}
