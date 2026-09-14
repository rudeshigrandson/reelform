import type { ChannelName, RequestOf, ResponseOf } from "@contracts";

/**
 * Thin renderer-side IPC client over the preload bridge. Falls back gracefully
 * when `window.reelform` is absent (e.g. Vite in a plain browser tab), so the
 * UI can be developed and tested outside Electron.
 */
export function isBridged(): boolean {
  return typeof window !== "undefined" && Boolean(window.reelform);
}

export async function invoke<K extends ChannelName>(
  channel: K,
  payload: RequestOf<K>,
): Promise<ResponseOf<K> | null> {
  if (!isBridged()) return null;
  return window.reelform.invoke(channel, payload);
}

/** Best-effort app version from the main process; null outside Electron. */
export async function getAppVersion(): Promise<string | null> {
  const res = await invoke("system:ping", undefined);
  return res?.version ?? null;
}
